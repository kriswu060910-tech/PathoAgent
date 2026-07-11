"""Cellpose 图像编解码工具。"""

import numpy as np
from PIL import Image

from shared_image_utils import decode_base64_to_pil, encode_pil_to_base64


def decode_image(image_b64: str) -> np.ndarray:
    """解码 base64 / data URL 为 RGB numpy 数组。"""
    img = decode_base64_to_pil(image_b64)
    return np.array(img)


def encode_image(img: np.ndarray, fmt: str = "JPEG", quality: int = 85) -> str:
    """编码 numpy 数组为 base64 data URL。"""
    pil = Image.fromarray(img)
    return encode_pil_to_base64(pil, fmt, quality)
