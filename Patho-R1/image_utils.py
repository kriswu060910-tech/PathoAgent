"""病理图像预处理与编解码工具。"""

import os
import tempfile
from contextlib import contextmanager
from typing import Generator

from PIL import Image

import config
from logger import setup_logger
from shared_image_utils import (
    MAX_IMAGE_BASE64_SIZE,
    MAX_IMAGE_PIXELS,
    ImageTooLargeError,
    decode_base64_to_pil,
)

logger = setup_logger("patho", config.PROJECT_ROOT / "logs")


def decode_base64_image(image_b64: str) -> Image.Image:
    """解码 base64 / data URL 为 PIL Image（RGB）。"""
    return decode_base64_to_pil(image_b64)


def preprocess_image(img: Image.Image, max_dim: int | None = None) -> Image.Image:
    """将图片缩放到指定最大维度以内，减少视觉 token 数量。"""
    max_dim = max_dim or config.MAX_IMAGE_DIM
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    scale = max_dim / max(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    logger.info(f"Resizing image {w}x{h} -> {new_w}x{new_h}")
    return img.resize((new_w, new_h), Image.LANCZOS)


@contextmanager
def temp_image_file(img: Image.Image) -> Generator[str, None, None]:
    """将图片保存到临时文件，退出上下文时自动删除。"""
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = tmp.name
            img.save(tmp_path, "JPEG")
        yield tmp_path
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
