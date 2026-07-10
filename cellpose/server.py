"""
Cellpose FastAPI 后端服务

提供细胞分割、计数与形态学测量 API，供前端 Agent 调用。

启动方式：
  cd D:\agent
  pip install cellpose fastapi uvicorn numpy pillow opencv-python-headless
  python cellpose/server.py                    # 默认端口 8002，使用 cyto3 模型
  python cellpose/server.py --model nuclei     # 使用 nuclei 模型
  python cellpose/server.py --port 8002        # 指定端口

API 端点：
  POST /segment   细胞分割 + 计数 + 标注叠加图
  POST /measure   详细形态学测量（面积、圆度、长轴/短轴）
  GET  /health    健康检查
"""

import argparse

# 模型文件存到 D 盘，必须在 import cellpose 之前设置
import os

import config

os.environ.setdefault(
    "CELLPOSE_LOCAL_MODELS_PATH", str(config.CELLPOSE_LOCAL_MODELS_PATH)
)

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analysis import (
    build_summary,
    compute_cell_info,
    compute_measurements,
    create_mask_image,
    create_overlay,
    run_segmentation,
)
from image_utils import encode_image

# ---------------------------------------------------------------------------
#  模型加载
# ---------------------------------------------------------------------------

model = None


def load_model(model_type: str):
    global model
    from cellpose.models import CellposeModel

    gpu = torch.cuda.is_available()
    print(f"[Cellpose] Loading model: {model_type} (GPU={gpu}) ...")
    model = CellposeModel(gpu=gpu, pretrained_model=model_type)
    print("[Cellpose] Model loaded successfully")


# ---------------------------------------------------------------------------
#  FastAPI 应用
# ---------------------------------------------------------------------------

app = FastAPI(title="Cellpose API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SegmentRequest(BaseModel):
    image: str  # base64 data URL 或纯 base64
    diameter: float | None = config.DEFAULT_DIAMETER
    flow_threshold: float = config.DEFAULT_FLOW_THRESHOLD
    cellprob_threshold: float = config.DEFAULT_CELLPROB_THRESHOLD
    channels: list[int] = config.DEFAULT_CHANNELS


class MeasureRequest(SegmentRequest):
    pixel_size: float | None = None  # 每像素微米数，用于换算实际尺寸


class CellInfo(BaseModel):
    id: int
    area_pixels: int
    area_um2: float | None = None
    centroid: list[float]
    bbox: list[int]


class CellMeasurement(CellInfo):
    perimeter_pixels: float
    circularity: float
    eccentricity: float
    major_axis: float
    minor_axis: float
    orientation: float


class SegmentResponse(BaseModel):
    cell_count: int
    cells: list[CellInfo]
    overlay_image: str
    mask_image: str


class MeasureResponse(BaseModel):
    cell_count: int
    cells: list[CellMeasurement]
    summary: dict
    overlay_image: str


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "model_type": getattr(model, "model_type", None) if model else None,
    }


@app.post("/segment", response_model=SegmentResponse)
async def segment(req: SegmentRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        img, mask = run_segmentation(
            model,
            req.image,
            req.diameter,
            req.channels,
            req.flow_threshold,
            req.cellprob_threshold,
        )
        cells = compute_cell_info(mask)
        return SegmentResponse(
            cell_count=len(cells),
            cells=[CellInfo(**c) for c in cells],
            overlay_image=encode_image(create_overlay(img, mask)),
            mask_image=encode_image(create_mask_image(mask), "PNG"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/measure", response_model=MeasureResponse)
async def measure(req: MeasureRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        img, mask = run_segmentation(
            model,
            req.image,
            req.diameter,
            req.channels,
            req.flow_threshold,
            req.cellprob_threshold,
        )
        cells = compute_measurements(mask, req.pixel_size)
        return MeasureResponse(
            cell_count=len(cells),
            cells=[CellMeasurement(**c) for c in cells],
            summary=build_summary(cells, req.pixel_size),
            overlay_image=encode_image(create_overlay(img, mask)),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
#  入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cellpose API Server")
    parser.add_argument(
        "--model",
        default=config.DEFAULT_MODEL_TYPE,
        choices=config.MODEL_TYPES,
        help="Cellpose 模型类型（默认 cyto3）",
    )
    parser.add_argument(
        "--port", type=int, default=config.DEFAULT_PORT, help="服务端口"
    )
    parser.add_argument(
        "--host", default=config.DEFAULT_HOST, help="绑定地址"
    )
    args = parser.parse_args()

    load_model(args.model)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
