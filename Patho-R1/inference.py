"""Patho-R1 推理流水线：构建消息、调用模型、解析输出。"""

import asyncio

import torch
from fastapi import HTTPException
from qwen_vl_utils import process_vision_info

import config
from image_utils import decode_base64_image, preprocess_image, temp_image_file
from logger import setup_logger
from model import ModelManager
from schemas import AnalyzeResponse

logger = setup_logger("patho", config.PROJECT_ROOT / "logs")


def build_messages(
    image_path: str,
    question: str,
    style: str,
    system_prompt: str | None = None,
) -> list[dict]:
    """根据图片路径、问题和风格构造对话消息。"""
    style_hint = (
        "Provide concise reasoning with at most 5 words per step."
        if style == "cod"
        else "Provide detailed step-by-step reasoning."
    )

    return [
        {
            "role": "system",
            "content": (system_prompt or config.SYSTEM_PROMPT) + " " + style_hint,
        },
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image_path},
                {"type": "text", "text": question},
            ],
        },
    ]


def generate(model_manager: ModelManager, messages: list[dict]) -> str:
    """运行模型生成原始文本输出。"""
    model = model_manager.model
    processor = model_manager.processor
    if model is None or processor is None:
        raise RuntimeError("Model not loaded")

    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    )
    inputs = inputs.to(model.device)

    with torch.no_grad():
        generated_ids = model.generate(**inputs, max_new_tokens=config.MAX_NEW_TOKENS)

    generated_ids_trimmed = [
        out_ids[len(in_ids) :]
        for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]
    raw_output = processor.batch_decode(
        generated_ids_trimmed, skip_special_tokens=True
    )[0]

    del inputs, generated_ids, generated_ids_trimmed
    return raw_output


def parse_output(raw_output: str) -> tuple[str, str]:
    """从模型原始输出中提取 <think> 和 <answer>。"""
    thinking = ""
    answer = raw_output

    if "<think>" in raw_output and "</think>" in raw_output:
        thinking = raw_output.split("<think>")[1].split("</think>")[0].strip()
    if "<answer>" in raw_output and "</answer>" in raw_output:
        answer = raw_output.split("<answer>")[1].split("</answer>")[0].strip()
    elif "</think>" in raw_output:
        answer = raw_output.split("</think>")[-1].strip()

    return thinking, answer


async def run_inference(
    model_manager: ModelManager,
    image_b64: str,
    question: str,
    style: str,
) -> AnalyzeResponse:
    """完整的单图推理入口：解码 → 预处理 → 生成 → 解析。

    使用 asyncio.to_thread 将同步推理放到线程池，避免阻塞事件循环。
    通过 model_manager.inference_lock 保证同一时刻只有一个推理任务在运行，
    降低 OOM 和输出错乱风险。
    """
    async with model_manager.inference_lock:
        try:
            img = decode_base64_image(image_b64)
            img = preprocess_image(img)

            with temp_image_file(img) as tmp_path:
                messages = build_messages(tmp_path, question, style)
                raw_output = await asyncio.to_thread(generate, model_manager, messages)
                thinking, answer = parse_output(raw_output)

            return AnalyzeResponse(
                thinking=thinking, answer=answer, raw=raw_output
            )
        except torch.cuda.OutOfMemoryError as exc:
            logger.error(f"GPU OOM: {exc}")
            raise HTTPException(status_code=500, detail=f"GPU 显存不足: {exc}") from exc
        except Exception as exc:
            logger.exception("推理失败")
            raise HTTPException(status_code=500, detail="推理失败，请检查日志") from exc
        finally:
            await asyncio.to_thread(model_manager.cleanup_gpu)
