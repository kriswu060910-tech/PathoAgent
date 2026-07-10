"""
Patho-R1 FastAPI 后端服务

提供 HTTP API 供前端 Agent 调用，封装 Patho-R1 模型的病理图像推理能力。

启动方式：
  cd D:\agent
  pip install fastapi uvicorn
  python Patho-R1/server.py                         # 默认加载 Patho-R1-7B
  python Patho-R1/server.py --model 3b              # 加载轻量 Patho-R1-3B
  python Patho-R1/server.py --port 8001             # 指定端口

API 端点：
  POST /analyze   接收 base64 图片 + 问题，返回病理分析结果
  POST /report    生成结构化诊断报告
  POST /region    区域聚焦分析
  GET  /health    健康检查
"""

import argparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config
from inference import run_inference
from model import ModelManager
from schemas import AnalyzeRequest, AnalyzeResponse, RegionRequest, ReportRequest

# ---------------------------------------------------------------------------
#  模型管理（全局单一实例）
# ---------------------------------------------------------------------------

model_manager = ModelManager()

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


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model_manager.is_loaded(),
        "device": str(model_manager.device) if model_manager.is_loaded() else None,
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    if not model_manager.is_loaded():
        raise HTTPException(status_code=503, detail="Model not loaded")
    return await run_inference(
        model_manager, req.image, req.question, req.style
    )


@app.post("/report", response_model=AnalyzeResponse)
async def report(req: ReportRequest):
    if not model_manager.is_loaded():
        raise HTTPException(status_code=503, detail="Model not loaded")

    clinical_suffix = (
        f"\nClinical information: {req.clinical_info}"
        if req.clinical_info
        else ""
    )
    question = config.REPORT_PROMPT + clinical_suffix
    return await run_inference(model_manager, req.image, question, "cot")


@app.post("/region", response_model=AnalyzeResponse)
async def region(req: RegionRequest):
    if not model_manager.is_loaded():
        raise HTTPException(status_code=503, detail="Model not loaded")

    if req.question:
        question = (
            f"Focus on the region described as '{req.region}' and answer: {req.question}"
        )
    else:
        question = (
            f"Focus on the region described as '{req.region}'. "
            "Describe in detail the cellular morphology, tissue architecture, "
            "staining characteristics, and any abnormal findings in this specific area."
        )
    return await run_inference(model_manager, req.image, question, req.style)


# ---------------------------------------------------------------------------
#  入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Patho-R1 API Server")
    parser.add_argument(
        "--model",
        default="7b",
        choices=list(config.MODEL_MAP.keys()),
        help="模型版本",
    )
    parser.add_argument(
        "--port", type=int, default=config.DEFAULT_PORT, help="服务端口"
    )
    parser.add_argument(
        "--host", default=config.DEFAULT_HOST, help="绑定地址"
    )
    args = parser.parse_args()

    model_manager.load(args.model)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
