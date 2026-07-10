"""Patho-R1 Pydantic 模型测试。"""

import pytest
from pydantic import ValidationError

import schemas


def test_analyze_request_defaults():
    req = schemas.AnalyzeRequest(image="data:image/png;base64,abc")
    assert req.question == "请分析这张病理图像，描述所见并给出诊断意见。"
    assert req.style == "cot"


def test_analyze_request_invalid_style_still_accepted():
    # Pydantic 目前未限制 style 取值，只验证类型
    req = schemas.AnalyzeRequest(image="abc", style="anything")
    assert req.style == "anything"


def test_analyze_request_missing_image_raises():
    with pytest.raises(ValidationError):
        schemas.AnalyzeRequest()


def test_analyze_response_model():
    resp = schemas.AnalyzeResponse(thinking="思考", answer="答案", raw="原始")
    assert resp.thinking == "思考"
    assert resp.answer == "答案"
    assert resp.raw == "原始"
