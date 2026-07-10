"""病理图像预处理与编解码工具。"""

import base64
import io
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from PIL import Image

import config

# base64 最大解码大小：20MB（防止恶意请求导致 OOM）
MAX_IMAGE_BASE64_SIZE = 20 * 1024 * 1024


def decode_base64_image(image_b64: str) -> Image.Image:
    """解码 base64 / data URL 为 PIL Image（RGB）。"""
    image_data = image_b64
    if image_data.startswith("data:"):
        image_data = image_data.split(",", 1)[1]

    if len(image_data) > MAX_IMAGE_BASE64_SIZE:
        raise ValueError(f"图片数据过大 ({len(image_data) / 1024 / 1024:.1f}MB)，上限 {MAX_IMAGE_BASE64_SIZE / 1024 / 1024:.0f}MB")

    img_bytes = base64.b64decode(image_data)
    return Image.open(io.BytesIO(img_bytes)).convert("RGB")


def preprocess_image(img: Image.Image, max_dim: int | None = None) -> Image.Image:
    """将图片缩放到指定最大维度以内，减少视觉 token 数量。"""
    max_dim = max_dim or config.MAX_IMAGE_DIM
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    scale = max_dim / max(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    print(f"[Patho-R1] Resizing image {w}x{h} -> {new_w}x{new_h}")
    return img.resize((new_w, new_h), Image.LANCZOS)


@contextmanager
def temp_image_file(img: Image.Image) -> Generator[str, None, None]:
    """将图片保存到临时文件，退出上下文时自动删除。"""
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            img.save(tmp.name, "JPEG")
            tmp_path = tmp.name
        yield tmp_path
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
