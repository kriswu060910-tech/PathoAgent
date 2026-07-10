"""Cellpose 图像编解码工具。"""

import base64
import io

import numpy as np
from PIL import Image

# base64 最大解码大小：20MB（防止恶意请求导致 OOM）
MAX_IMAGE_BASE64_SIZE = 20 * 1024 * 1024


def decode_image(image_b64: str) -> np.ndarray:
    """解码 base64 / data URL 为 RGB numpy 数组。"""
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]

    if len(image_b64) > MAX_IMAGE_BASE64_SIZE:
        raise ValueError(f"图片数据过大 ({len(image_b64) / 1024 / 1024:.1f}MB)，上限 {MAX_IMAGE_BASE64_SIZE / 1024 / 1024:.0f}MB")

    return np.array(
        Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
    )


def encode_image(img: np.ndarray, fmt: str = "JPEG", quality: int = 85) -> str:
    """编码 numpy 数组为 base64 data URL。"""
    pil = Image.fromarray(img)
    buf = io.BytesIO()
    if fmt == "JPEG":
        pil.save(buf, format=fmt, quality=quality)
    else:
        pil.save(buf, format=fmt)
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"
