"""Cellpose 分割、测量与可视化逻辑。"""

import cv2
import numpy as np

import config


# ---------------------------------------------------------------------------
#  模型推理
# ---------------------------------------------------------------------------


def run_segmentation(
    model,
    image_b64: str,
    diameter,
    channels,
    flow_threshold,
    cellprob_threshold,
):
    """解码图片 → 运行 Cellpose → 返回 (img, mask)。"""
    from image_utils import decode_image

    img = decode_image(image_b64)
    result = model.eval(
        [img],
        diameter=diameter,
        channels=channels,
        flow_threshold=flow_threshold,
        cellprob_threshold=cellprob_threshold,
    )
    return img, result[0][0]


# ---------------------------------------------------------------------------
#  可视化
# ---------------------------------------------------------------------------


def _palette(n: int) -> np.ndarray:
    """生成 n+1 色调色板（索引 0 为背景黑色）。"""
    rng = np.random.RandomState(42)
    colors = rng.randint(60, 255, size=(n + 1, 3), dtype=np.uint8)
    colors[0] = [0, 0, 0]
    return colors


def _cell_contour(mask_i: np.ndarray):
    """从单个细胞二值掩膜提取轮廓，返回 (contour, area_px, cx, cy) 或 None。"""
    binary = mask_i.astype(np.uint8)
    area_px = int(binary.sum())
    if area_px == 0:
        return None
    contours, _ = cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None
    contour = contours[0]
    M = cv2.moments(contour)
    cx = float(M["m10"] / M["m00"]) if M["m00"] > 0 else 0.0
    cy = float(M["m01"] / M["m00"]) if M["m00"] > 0 else 0.0
    return contour, area_px, cx, cy


def create_overlay(img: np.ndarray, masks: np.ndarray) -> np.ndarray:
    """创建分割标注叠加图（半透明色块 + 轮廓 + 编号）。"""
    overlay = img.copy()
    n = masks.max()
    if n == 0:
        return overlay

    colors = _palette(n)

    for i in range(1, n + 1):
        region = masks == i
        if not region.any():
            continue
        overlay[region] = (
            overlay[region] * (1 - config.OVERLAY_ALPHA)
            + colors[i] * config.OVERLAY_ALPHA
        ).astype(np.uint8)

    for i in range(1, n + 1):
        info = _cell_contour(masks == i)
        if info is None:
            continue
        contour, _, cx, cy = info
        cv2.drawContours(overlay, [contour], -1, config.CONTOUR_COLOR, 1)
        label = str(i)
        (tw, th), _ = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, config.LABEL_FONT, config.LABEL_THICKNESS
        )
        ix, iy = int(cx), int(cy)
        cv2.rectangle(
            overlay,
            (ix - 1, iy - th - 2),
            (ix + tw + 1, iy + 2),
            (0, 0, 0),
            -1,
        )
        cv2.putText(
            overlay,
            label,
            (ix, iy),
            cv2.FONT_HERSHEY_SIMPLEX,
            config.LABEL_FONT,
            (255, 255, 255),
            config.LABEL_THICKNESS,
        )

    return overlay


def create_mask_image(masks: np.ndarray) -> np.ndarray:
    """创建纯掩膜可视化（彩色标签）。"""
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


def _cell_info_dict(
    cell_id: int,
    contour,
    area_px: int,
    cx: float,
    cy: float,
    pixel_size: float | None,
) -> dict:
    """构建单个细胞的基础信息字典。"""
    x, y, w, h = cv2.boundingRect(contour)
    info = {
        "id": cell_id,
        "area_pixels": area_px,
        "centroid": [round(cx, 1), round(cy, 1)],
        "bbox": [x, y, x + w, y + h],
    }
    if pixel_size:
        info["area_um2"] = round(area_px * pixel_size ** 2, 2)
    return info


def compute_cell_info(masks: np.ndarray, pixel_size: float | None = None) -> list[dict]:
    """计算每个细胞的基本信息（面积、质心、边界框）。"""
    cells = []
    for i in range(1, masks.max() + 1):
        info = _cell_contour(masks == i)
        if info is None:
            continue
        contour, area_px, cx, cy = info
        cells.append(_cell_info_dict(i, contour, area_px, cx, cy, pixel_size))
    return cells


def compute_measurements(
    masks: np.ndarray, pixel_size: float | None = None
) -> list[dict]:
    """计算每个细胞的详细形态学测量。"""
    results = []
    for i in range(1, masks.max() + 1):
        info = _cell_contour(masks == i)
        if info is None:
            continue
        contour, area_px, cx, cy = info
        x, y, w, h = cv2.boundingRect(contour)
        perimeter = cv2.arcLength(contour, closed=True)
        circularity = (
            (4 * np.pi * area_px / perimeter ** 2) if perimeter > 0 else 0.0
        )

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

        cell = _cell_info_dict(i, contour, area_px, cx, cy, pixel_size)
        cell.update(
            {
                "perimeter_pixels": round(float(perimeter), 2),
                "circularity": round(float(circularity), 3),
                "eccentricity": round(float(eccentricity), 3),
                "major_axis": round(float(MA), 2),
                "minor_axis": round(float(ma), 2),
                "orientation": round(float(angle), 1),
            }
        )
        results.append(cell)
    return results


def build_summary(cells: list[dict], pixel_size: float | None) -> dict:
    """构建测量统计摘要。"""
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
        areas_um = [c["area_um2"] for c in cells if c.get("area_um2")]
        if areas_um:
            s["mean_area_um2"] = round(float(np.mean(areas_um)), 2)
            s["median_area_um2"] = round(float(np.median(areas_um)), 2)
    return s
