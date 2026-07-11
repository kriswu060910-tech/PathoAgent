"""共享图片编解码工具 — 供 Patho-R1 和 Cellpose 复用。"""

import base64
import binascii
import io

from PIL import Image
from PIL.Image import DecompressionBombError

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


def strip_data_url(image_b64: str) -> str:
    """去除 data URL 前缀，返回纯 base64 字符串。"""
    if image_b64.startswith("data:"):
        return image_b64.split(",", 1)[1]
    return image_b64


def validate_and_decode_base64(image_b64: str) -> bytes:
    """校验大小并解码 base64 为原始字节。"""
    if len(image_b64) > MAX_IMAGE_BASE64_SIZE:
        raise ImageTooLargeError(len(image_b64), MAX_IMAGE_BASE64_SIZE)

    try:
        return base64.b64decode(image_b64, validate=True)
    except binascii.Error as exc:
        raise ValueError(f"图片 base64 数据无效: {exc}") from exc


def decode_base64_to_pil(image_b64: str) -> Image.Image:
    """解码 base64 / data URL 为 PIL Image（RGB），含大小校验。"""
    raw = strip_data_url(image_b64)
    img_bytes = validate_and_decode_base64(raw)

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


def encode_pil_to_base64(img: Image.Image, fmt: str = "JPEG", quality: int = 85) -> str:
    """编码 PIL Image 为 base64 data URL。"""
    buf = io.BytesIO()
    if fmt == "JPEG":
        img.save(buf, format=fmt, quality=quality)
    else:
        img.save(buf, format=fmt)
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"
