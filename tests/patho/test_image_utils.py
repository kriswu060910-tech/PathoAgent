"""Patho-R1 图片工具测试。"""

import base64
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

import image_utils


def _make_png() -> bytes:
    """生成一个有效的 1x1 红色 PNG 字节。"""
    buf = BytesIO()
    Image.new("RGB", (1, 1), color="red").save(buf, format="PNG")
    return buf.getvalue()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def test_decode_base64_image_accepts_plain_b64():
    img = image_utils.decode_base64_image(_b64(_make_png()))
    assert img.size == (1, 1)
    assert img.mode == "RGB"


def test_decode_base64_image_accepts_data_url():
    data_url = f"data:image/png;base64,{_b64(_make_png())}"
    img = image_utils.decode_base64_image(data_url)
    assert img.size == (1, 1)


def test_decode_base64_image_rejects_invalid_b64():
    with pytest.raises(ValueError, match="base64"):
        image_utils.decode_base64_image("!!!not-base64!!!")


def test_decode_base64_image_rejects_oversized():
    huge = "A" * (image_utils.MAX_IMAGE_BASE64_SIZE + 1)
    with pytest.raises(image_utils.ImageTooLargeError):
        image_utils.decode_base64_image(huge)


def test_decode_base64_image_rejects_too_many_pixels(monkeypatch):
    monkeypatch.setattr(image_utils, "MAX_IMAGE_PIXELS", 10)
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10_000 * 10_000)
    img = Image.new("RGB", (10, 10), color="red")
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    with pytest.raises(image_utils.ImageTooLargeError):
        image_utils.decode_base64_image(b64)


def test_decode_base64_image_rejects_decompression_bomb(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10)
    img = Image.new("RGB", (10, 10), color="red")
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    with pytest.raises(image_utils.ImageTooLargeError):
        image_utils.decode_base64_image(b64)


def test_preprocess_image_does_not_resize_small_image():
    from PIL import Image

    img = Image.new("RGB", (100, 100), color="red")
    processed = image_utils.preprocess_image(img, max_dim=512)
    assert processed.size == (100, 100)


def test_preprocess_image_resizes_large_image():
    from PIL import Image

    img = Image.new("RGB", (1000, 500), color="red")
    processed = image_utils.preprocess_image(img, max_dim=512)
    assert max(processed.size) == 512
    assert processed.size[0] == 512
    assert processed.size[1] == 256


def test_temp_image_file_cleans_up():
    img = Image.new("RGB", (10, 10), color="red")
    tmp_path: str | None = None
    with image_utils.temp_image_file(img) as path:
        tmp_path = path
        assert Path(tmp_path).exists()
    assert tmp_path is not None
    assert not Path(tmp_path).exists()
