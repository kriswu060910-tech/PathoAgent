"""
Patho-R1 FastAPI 后端服务

提供 HTTP API 供前端 Agent 调用，封装 Patho-R1 模型的病理图像推理能力。

启动方式：
  pip install fastapi uvicorn
  python server.py                          # 默认加载 Patho-R1-7B
  python server.py --model 3b               # 加载轻量 Patho-R1-3B
  python server.py --port 8001              # 指定端口

API 端点：
  POST /analyze   接收 base64 图片 + 问题，返回病理分析结果
  GET  /health    健康检查
"""

import argparse
import base64
import io
import os
import sys
import tempfile
from pathlib import Path

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

# 推理前限制图片最大维度，防止高分辨率图片导致 OOM
MAX_IMAGE_DIM = 512


def preprocess_image(img: Image.Image) -> Image.Image:
    """将图片缩放到 MAX_IMAGE_DIM 以内，减少视觉 token 数量"""
    w, h = img.size
    if max(w, h) <= MAX_IMAGE_DIM:
        return img
    scale = MAX_IMAGE_DIM / max(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    print(f"[Patho-R1] Resizing image {w}x{h} -> {new_w}x{new_h}")
    return img.resize((new_w, new_h), Image.LANCZOS)


def cleanup_gpu():
    """释放 GPU 缓存，防止多次推理后 OOM"""
    import gc
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

# ---------------------------------------------------------------------------
#  模型加载（延迟到启动时）
# ---------------------------------------------------------------------------

MODEL_MAP = {
    "7b": "WenchuanZhang/Patho-R1-7B",
    "3b": "WenchuanZhang/Patho-R1-3B",
    "qwen": "D:/hf_models/models/Qwen--Qwen2.5-VL-3B-Instruct/snapshots/master",
}

model = None
processor = None

SYSTEM_PROMPT = (
    "You are Patho-R1, a pathology expert capable of analyzing histopathology images. "
    "Provide structured, step-by-step diagnostic reasoning. "
    "Use <think>...</think> for your reasoning process and <answer>...</answer> for the final diagnosis."
)


def load_model(model_key: str):
    global model, processor
    from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor

    model_name = MODEL_MAP.get(model_key, MODEL_MAP["7b"])
    print(f"[Patho-R1] Loading model: {model_name} ...")

    if torch.cuda.is_available():
        from transformers import BitsAndBytesConfig
        quant_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
        model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            model_name,
            quantization_config=quant_config,
            device_map="auto",
            attn_implementation="sdpa",
        )
    else:
        model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            model_name,
            torch_dtype=torch.float32,
            device_map="cpu",
        )
    processor = AutoProcessor.from_pretrained(model_name)
    print(f"[Patho-R1] Model loaded successfully on {model.device}")


# ---------------------------------------------------------------------------
#  FastAPI 应用
# ---------------------------------------------------------------------------

app = FastAPI(title="Patho-R1 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    """病理分析请求"""
    image: str  # base64 data URL 或纯 base64 字符串
    question: str = "请分析这张病理图像，描述所见并给出诊断意见。"
    style: str = "cot"  # cot (详细推理) 或 cod (简洁推理)


class ReportRequest(BaseModel):
    """结构化报告请求"""
    image: str
    clinical_info: str = ""
    template: str = "standard"  # standard / brief / detailed


class RegionRequest(BaseModel):
    """区域聚焦分析请求"""
    image: str
    region: str  # 自然语言描述目标区域
    question: str = ""
    style: str = "cot"


class AnalyzeResponse(BaseModel):
    """病理分析响应"""
    thinking: str  # <think> 中的推理过程
    answer: str  # <answer> 中的最终诊断
    raw: str  # 完整原始输出


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "device": str(model.device) if model else None,
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return await _run_inference(req.image, req.question, req.style)


REPORT_PROMPT = (
    "Based on this pathology image, generate a structured diagnostic report with the following sections:\n"
    "1. **Diagnostic Conclusion**: Most likely pathological diagnosis\n"
    "2. **Key Findings**: Morphological features supporting the diagnosis (at least 3 points)\n"
    "3. **Grading/Staging**: If applicable (e.g., Gleason score, WHO grade, TNM staging)\n"
    "4. **Differential Diagnosis**: Other possibilities to rule out\n"
    "5. **Clinical Recommendations**: Further tests or follow-up suggestions"
)


@app.post("/report", response_model=AnalyzeResponse)
async def report(req: ReportRequest):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    clinical_suffix = f"\nClinical information: {req.clinical_info}" if req.clinical_info else ""
    question = REPORT_PROMPT + clinical_suffix
    return await _run_inference(req.image, question, "cot")


@app.post("/region", response_model=AnalyzeResponse)
async def region(req: RegionRequest):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if req.question:
        question = f"Focus on the region described as '{req.region}' and answer: {req.question}"
    else:
        question = (
            f"Focus on the region described as '{req.region}'. "
            "Describe in detail the cellular morphology, tissue architecture, "
            "staining characteristics, and any abnormal findings in this specific area."
        )
    return await _run_inference(req.image, question, req.style)


async def _run_inference(image_b64: str, question: str, style: str) -> AnalyzeResponse:
    """共享推理逻辑"""
    from qwen_vl_utils import process_vision_info

    image_data = image_b64
    if image_data.startswith("data:"):
        image_data = image_data.split(",", 1)[1]

    img_bytes = base64.b64decode(image_data)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img = preprocess_image(img)

    tmp_path = None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        img.save(tmp.name, "JPEG")
        tmp_path = tmp.name

        style_hint = (
            "Provide concise reasoning with at most 5 words per step."
            if style == "cod"
            else "Provide detailed step-by-step reasoning."
        )

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT + " " + style_hint},
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": tmp_path},
                    {"type": "text", "text": question},
                ],
            },
        ]

        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = processor(
            text=[text], images=image_inputs, videos=video_inputs,
            padding=True, return_tensors="pt",
        )
        inputs = inputs.to(model.device)

        with torch.no_grad():
            generated_ids = model.generate(**inputs, max_new_tokens=1024)

        generated_ids_trimmed = [
            out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]
        raw_output = processor.batch_decode(generated_ids_trimmed, skip_special_tokens=True)[0]

        del inputs, generated_ids, generated_ids_trimmed
        torch.cuda.empty_cache()

        thinking = ""
        answer = raw_output
        if "<think>" in raw_output and "</think>" in raw_output:
            thinking = raw_output.split("<think>")[1].split("</think>")[0].strip()
        if "<answer>" in raw_output and "</answer>" in raw_output:
            answer = raw_output.split("<answer>")[1].split("</answer>")[0].strip()
        elif "</think>" in raw_output:
            answer = raw_output.split("</think>")[-1].strip()

        return AnalyzeResponse(thinking=thinking, answer=answer, raw=raw_output)
    except torch.cuda.OutOfMemoryError as e:
        cleanup_gpu()
        raise HTTPException(status_code=500, detail=f"GPU 显存不足: {e}")
    finally:
        cleanup_gpu()
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ---------------------------------------------------------------------------
#  入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Patho-R1 API Server")
    parser.add_argument("--model", default="7b", choices=list(MODEL_MAP.keys()), help="模型版本")
    parser.add_argument("--port", type=int, default=8001, help="服务端口")
    parser.add_argument("--host", default="0.0.0.0", help="绑定地址")
    args = parser.parse_args()

    load_model(args.model)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
