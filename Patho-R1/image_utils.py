"""病理图像预处理与编解码工具。"""

import base64
import binascii
import io
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from PIL import Image
from PIL.Image import DecompressionBombError

import config
from logger import setup_logger

logger = setup_logger("patho", config.PROJECT_ROOT / "logs")

# base64 最大解码大小：20MB（防止恶意请求导致 OOM）
MAX_IMAGE_BASE64_SIZE = 20 * 1024 * 1024

# 图片最大像素数：20,000 x 20,000（PIL 解压缩炸弹防护）
MAX_IMAGE_PIXELS = 20_000 * 20_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class ImageTooLargeError(ValueError):
    """图片超过允许的最大大小（base64 数据量或像素数）。"""

    def __init__(self, size: int, limit: int, kind: str = "base64") -> None:
        self.size = size
        self.limit = limit
        self.kind = kind
        if kind == "pixels":
            super().__init__(
                f"图片像素过多 ({size:,})，上限 {limit:,} 像素"
            )
        else:
            super().__init__(
                f"图片数据过大 ({size / 1024 / 1024:.1f}MB)，"
                f"上限 {limit / 1024 / 1024:.0f}MB"
            )


def decode_base64_image(image_b64: str) -> Image.Image:
    """解码 base64 / data URL 为 PIL Image（RGB）。"""
    image_data = image_b64
    if image_data.startswith("data:"):
        image_data = image_data.split(",", 1)[1]

    if len(image_data) > MAX_IMAGE_BASE64_SIZE:
        raise ImageTooLargeError(len(image_data), MAX_IMAGE_BASE64_SIZE)

    try:
        img_bytes = base64.b64decode(image_data, validate=True)
    except binascii.Error as exc:
        raise ValueError(f"图片 base64 数据无效: {exc}") from exc

    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except DecompressionBombError as exc:
        raise ImageTooLargeError(0, MAX_IMAGE_PIXELS, kind="pixels") from exc
    except Exception as exc:
        raise ValueError(f"无法解析图片文件: {exc}") from exc

    if img.width * img.height > MAX_IMAGE_PIXELS:
        raise ImageTooLargeError(
            img.width * img.height, MAX_IMAGE_PIXELS, kind="pixels"
        )

    return img


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
