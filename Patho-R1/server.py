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

import sys

# 启动自检：检查关键依赖
_missing = []
for _pkg, _import in [("fastapi", "fastapi"), ("uvicorn", "uvicorn"), ("torch", "torch"),
                       ("transformers", "transformers"), ("bitsandbytes", "bitsandbytes")]:
    try:
        __import__(_import)
    except ImportError:
        _missing.append(_pkg)
if _missing:
    print(f"[Patho-R1] 缺少依赖包: {', '.join(_missing)}")
    print(f"[Patho-R1] 请安装: {sys.executable} -m pip install {' '.join(_missing)}")
    sys.exit(1)

import argparse
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import config
from image_utils import ImageTooLargeError
from inference import run_inference
from logger import setup_logger
from model import ModelManager
from schemas import AnalyzeRequest, AnalyzeResponse, RegionRequest, ReportRequest

logger = setup_logger("patho", config.PROJECT_ROOT / "logs")

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
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "tauri://localhost",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(ImageTooLargeError)
async def image_too_large_handler(_request: Request, exc: ImageTooLargeError):
    logger.warning(f"图片过大: {exc.size / 1024 / 1024:.1f}MB")
    return JSONResponse(
        status_code=413,
        content={"detail": str(exc)},
    )


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError):
    logger.warning(f"请求参数错误: {type(exc).__name__}")
    return JSONResponse(
        status_code=400,
        content={"detail": "请求参数错误，请检查输入"},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(_request: Request, exc: Exception):
    logger.exception("未处理异常")
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请查看日志"},
    )


@app.get("/health")
async def health():
    import torch
    info = {
        "status": "ok",
        "model_loaded": model_manager.is_loaded(),
        "device": str(model_manager.device) if model_manager.is_loaded() else None,
    }
    if model_manager.is_loaded() and torch.cuda.is_available():
        info["vram_gb"] = round(torch.cuda.memory_allocated() / 1024**3, 2)
    return info


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
    parser.add_argument(
        "--quant", action=argparse.BooleanOptionalAction, default=True,
        help="启用 4-bit NF4 量化（默认开启，--no-quant 关闭，显存 ~6GB）",
    )
    args = parser.parse_args()

    model_name = config.MODEL_MAP.get(args.model, config.MODEL_MAP["7b"])
    quant_str = "4-bit" if args.quant else "fp16"
    logger.info(f"Patho-R1 服务启动: host={args.host}, port={args.port}, model={args.model}, quant={quant_str}")

    if not Path(model_name).exists() and "/" not in model_name and "\\" not in model_name:
        logger.warning(f"模型路径/ID 看起来无效: {model_name}")

    model_manager.load(args.model, quantize=args.quant)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
