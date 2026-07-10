"""
Cellpose FastAPI 后端服务

提供细胞分割、计数与形态学测量 API，供前端 Agent 调用。

启动方式：
  pip install cellpose fastapi uvicorn numpy pillow opencv-python-headless
  python server.py                    # 默认端口 8002，使用 cyto3 模型
  python server.py --model nuclei     # 使用 nuclei 模型
  python server.py --port 8002        # 指定端口

API 端点：
  POST /segment   细胞分割 + 计数 + 标注叠加图
  POST /measure   详细形态学测量（面积、圆度、长轴/短轴）
  GET  /health    健康检查
"""

import argparse
import base64
import io
import os

# 模型文件存到 D 盘，必须在 import cellpose 之前设置
os.environ.setdefault("CELLPOSE_LOCAL_MODELS_PATH", r"D:\cellpose\models")

import cv2
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

# ---------------------------------------------------------------------------
#  模型加载
# ---------------------------------------------------------------------------

MODEL_TYPES = ["cyto3", "nuclei", "tissuenet", "livecell", "cyto2", "cyto"]

model = None


def load_model(model_type: str):
    global model
    from cellpose.models import CellposeModel

    gpu = torch.cuda.is_available()
    print(f"[Cellpose] Loading model: {model_type} (GPU={gpu}) ...")
    model = CellposeModel(gpu=gpu, pretrained_model=model_type)
    print("[Cellpose] Model loaded successfully")


# ---------------------------------------------------------------------------
#  共享工具函数
# ---------------------------------------------------------------------------


def _run_segmentation(image_b64: str, diameter, channels, flow_threshold, cellprob_threshold):
    """解码图片 → 运行 Cellpose → 返回 (img, mask)"""
    img = _decode_image(image_b64)
    result = model.eval(
        [img],
        diameter=diameter,
        channels=channels,
        flow_threshold=flow_threshold,
        cellprob_threshold=cellprob_threshold,
    )
    return img, result[0][0]


def _palette(n: int) -> np.ndarray:
    """生成 n+1 色调色板（索引 0 为背景黑色）"""
    rng = np.random.RandomState(42)
    colors = rng.randint(60, 255, size=(n + 1, 3), dtype=np.uint8)
    colors[0] = [0, 0, 0]
    return colors


def _cell_contour(mask_i: np.ndarray):
    """从单个细胞二值掩膜提取轮廓，返回 (contour, area_px, cx, cy) 或 None"""
    binary = mask_i.astype(np.uint8)
    area_px = int(binary.sum())
    if area_px == 0:
        return None
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = contours[0]
    M = cv2.moments(contour)
    cx = float(M["m10"] / M["m00"]) if M["m00"] > 0 else 0.0
    cy = float(M["m01"] / M["m00"]) if M["m00"] > 0 else 0.0
    return contour, area_px, cx, cy


def _decode_image(image_b64: str) -> np.ndarray:
    """解码 base64 图片为 numpy 数组"""
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]
    return np.array(Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB"))


def _encode_image(img: np.ndarray, fmt: str = "JPEG", quality: int = 85) -> str:
    """编码 numpy 数组为 base64 data URL"""
    pil = Image.fromarray(img)
    buf = io.BytesIO()
    pil.save(buf, format=fmt, quality=quality) if fmt == "JPEG" else pil.save(buf, format=fmt)
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"


# ---------------------------------------------------------------------------
#  可视化
# ---------------------------------------------------------------------------


def _create_overlay(img: np.ndarray, masks: np.ndarray) -> np.ndarray:
    """创建分割标注叠加图（半透明色块 + 轮廓 + 编号）"""
    overlay = img.copy()
    n = masks.max()
    if n == 0:
        return overlay

    colors = _palette(n)
    alpha = 0.3

    for i in range(1, n + 1):
        region = masks == i
        if not region.any():
            continue
        overlay[region] = (overlay[region] * (1 - alpha) + colors[i] * alpha).astype(np.uint8)

    for i in range(1, n + 1):
        info = _cell_contour(masks == i)
        if info is None:
            continue
        contour, _, cx, cy = info
        cv2.drawContours(overlay, [contour], -1, (255, 255, 0), 1)
        label = str(i)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.35, 1)
        ix, iy = int(cx), int(cy)
        cv2.rectangle(overlay, (ix - 1, iy - th - 2), (ix + tw + 1, iy + 2), (0, 0, 0), -1)
        cv2.putText(overlay, label, (ix, iy), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)

    return overlay


def _create_mask_image(masks: np.ndarray) -> np.ndarray:
    """创建纯掩膜可视化（彩色标签）"""
    n = masks.max()
    if n == 0:
        return np.zeros((*masks.shape, 3), dtype=np.uint8)
    colors = _palette(n)
    vis = np.zeros((*masks.shape, 3), dtype=np.uint8)
    for i in range(1, n + 1):
        vis[masks == i] = colors[i]
    return vis


# ---------------------------------------------------------------------------
#  细胞分析
# ---------------------------------------------------------------------------


def _compute_cell_info(masks: np.ndarray, pixel_size: float | None = None) -> list[dict]:
    """计算每个细胞的基本信息（面积、质心、边界框）"""
    cells = []
    for i in range(1, masks.max() + 1):
        info = _cell_contour(masks == i)
        if info is None:
            continue
        _, area_px, cx, cy = info
        x, y, w, h = cv2.boundingRect(info[0])
        cells.append({
            "id": i,
            "area_pixels": area_px,
            "area_um2": round(area_px * pixel_size ** 2, 2) if pixel_size else None,
            "centroid": [round(cx, 1), round(cy, 1)],
            "bbox": [x, y, x + w, y + h],
        })
    return cells


def _compute_measurements(masks: np.ndarray, pixel_size: float | None = None) -> list[dict]:
    """计算每个细胞的详细形态学测量（面积、周长、圆度、离心率、长短轴、方向）"""
    results = []
    for i in range(1, masks.max() + 1):
        info = _cell_contour(masks == i)
        if info is None:
            continue
        contour, area_px, cx, cy = info
        x, y, w, h = cv2.boundingRect(contour)
        perimeter = cv2.arcLength(contour, closed=True)
        circularity = (4 * np.pi * area_px / perimeter ** 2) if perimeter > 0 else 0.0

        # 椭圆拟合（至少需要 5 个点）
        if len(contour) >= 5:
            (_, _), (ma, MA), angle = cv2.fitEllipse(contour)
            if ma > MA:
                ma, MA = MA, ma
                angle += 90
            eccentricity = np.sqrt(1 - (ma / MA) ** 2) if MA > 0 else 0.0
        else:
            ma = MA = angle = 0.0
            eccentricity = 0.0

        results.append({
            "id": i,
            "area_pixels": area_px,
            "area_um2": round(area_px * pixel_size ** 2, 2) if pixel_size else None,
            "perimeter_pixels": round(float(perimeter), 2),
            "circularity": round(float(circularity), 3),
            "eccentricity": round(float(eccentricity), 3),
            "major_axis": round(float(MA), 2),
            "minor_axis": round(float(ma), 2),
            "orientation": round(float(angle), 1),
            "centroid": [round(cx, 1), round(cy, 1)],
            "bbox": [x, y, x + w, y + h],
        })
    return results


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
    image: str                         # base64 data URL 或纯 base64
    diameter: float | None = None      # 细胞直径（像素），None 为自动估计
    flow_threshold: float = 0.4        # 流场阈值（0-1，越低越严格）
    cellprob_threshold: float = 0.0    # 细胞概率阈值（-6 到 6）
    channels: list[int] = [0, 0]       # 通道配置，默认 [0, 0] 表示灰度


class MeasureRequest(SegmentRequest):
    pixel_size: float | None = None    # 每像素微米数，用于换算实际尺寸


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
        img, mask = _run_segmentation(
            req.image, req.diameter, req.channels,
            req.flow_threshold, req.cellprob_threshold,
        )
        cells = _compute_cell_info(mask)
        return SegmentResponse(
            cell_count=len(cells),
            cells=[CellInfo(**c) for c in cells],
            overlay_image=_encode_image(_create_overlay(img, mask)),
            mask_image=_encode_image(_create_mask_image(mask), "PNG"),
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
        img, mask = _run_segmentation(
            req.image, req.diameter, req.channels,
            req.flow_threshold, req.cellprob_threshold,
        )
        cells = _compute_measurements(mask, req.pixel_size)
        return MeasureResponse(
            cell_count=len(cells),
            cells=[CellMeasurement(**c) for c in cells],
            summary=_build_summary(cells, req.pixel_size),
            overlay_image=_encode_image(_create_overlay(img, mask)),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _build_summary(cells: list[dict], pixel_size: float | None) -> dict:
    """构建测量统计摘要"""
    areas = [c["area_pixels"] for c in cells]
    circs = [c["circularity"] for c in cells]
    s = {
        "total_cells": len(cells),
        "mean_area_px": round(float(np.mean(areas)), 1) if areas else 0,
        "median_area_px": round(float(np.median(areas)), 1) if areas else 0,
        "std_area_px": round(float(np.std(areas)), 1) if areas else 0,
        "mean_circularity": round(float(np.mean(circs)), 3) if circs else 0,
    }
    if pixel_size:
        areas_um = [c["area_um2"] for c in cells if c["area_um2"]]
        if areas_um:
            s["mean_area_um2"] = round(float(np.mean(areas_um)), 2)
            s["median_area_um2"] = round(float(np.median(areas_um)), 2)
    return s


# ---------------------------------------------------------------------------
#  入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cellpose API Server")
    parser.add_argument(
        "--model", default="cyto3", choices=MODEL_TYPES,
        help="Cellpose 模型类型（默认 cyto3）",
    )
    parser.add_argument("--port", type=int, default=8002, help="服务端口")
    parser.add_argument("--host", default="0.0.0.0", help="绑定地址")
    args = parser.parse_args()

    load_model(args.model)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
