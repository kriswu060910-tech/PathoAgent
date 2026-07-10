"""Cellpose 图像编解码工具。"""

import base64
import binascii
import io

import numpy as np
from PIL import Image

# base64 最大解码大小：20MB（防止恶意请求导致 OOM）
MAX_IMAGE_BASE64_SIZE = 20 * 1024 * 1024

# 最大图像像素数：防止解压缩炸弹 / 超大图片导致 OOM
MAX_IMAGE_PIXELS = 20_000 * 20_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def decode_image(image_b64: str) -> np.ndarray:
    """解码 base64 / data URL 为 RGB numpy 数组。"""
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]

    if len(image_b64) > MAX_IMAGE_BASE64_SIZE:
        raise ValueError(f"图片数据过大 ({len(image_b64) / 1024 / 1024:.1f}MB)，上限 {MAX_IMAGE_BASE64_SIZE / 1024 / 1024:.0f}MB")

    try:
        raw = base64.b64decode(image_b64)
    except binascii.Error as e:
        raise ValueError("Base64 图片数据解码失败，请检查输入是否有效") from e

    try:
        img = Image.open(io.BytesIO(raw))
    except (Image.DecompressionBombError, OSError, MemoryError) as e:
        raise ValueError(f"图片无法打开或像素过大: {e}") from e

    if img.width * img.height > MAX_IMAGE_PIXELS:
        raise ValueError(
            f"图片像素过多 ({img.width * img.height})，超过上限 {MAX_IMAGE_PIXELS}"
        )

    try:
        return np.array(img.convert("RGB"))
    except (Image.DecompressionBombError, OSError, MemoryError) as e:
        raise ValueError(f"图片无法处理或像素过大: {e}") from e


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
