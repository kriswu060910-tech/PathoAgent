"""Patho-R1 API 的 Pydantic 请求/响应模型。"""

from typing import Literal

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    """病理分析请求"""

    image: str  # base64 data URL 或纯 base64 字符串
    question: str = Field(default="请分析这张病理图像，描述所见并给出诊断意见。", max_length=5000)
    style: Literal["cot", "cod"] = "cot"  # cot (详细推理) 或 cod (简洁推理)


class ReportRequest(BaseModel):
    """结构化报告请求"""

    image: str
    clinical_info: str = Field(default="", max_length=2000)
    template: str = "standard"  # standard / brief / detailed


class RegionRequest(BaseModel):
    """区域聚焦分析请求"""

    image: str
    region: str  # 自然语言描述目标区域
    question: str = ""
    style: str = "cot"


class AnalyzeResponse(BaseModel):
    """病理分析响应"""

    thinking: str  # <think> 中的推理过程
    answer: str  # <answer> 中的最终诊断
    raw: str  # 完整原始输出
