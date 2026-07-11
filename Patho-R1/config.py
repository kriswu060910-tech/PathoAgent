"""Patho-R1 后端配置。

所有可配置项集中在此，支持通过环境变量覆盖，方便不同机器部署。
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
#  路径与模型
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent

MODEL_MAP = {
    "7b": "WenchuanZhang/Patho-R1-7B",
    "3b": "WenchuanZhang/Patho-R1-3B",
    "qwen": os.environ.get("PATHO_QWEN_MODEL_PATH", "Qwen/Qwen2.5-VL-3B-Instruct"),
}

# ---------------------------------------------------------------------------
#  推理参数
# ---------------------------------------------------------------------------

def _int_env(key: str, default: int) -> int:
    """安全地读取整数类型环境变量，格式错误时返回默认值。"""
    try:
        return int(os.environ.get(key, default))
    except (ValueError, TypeError):
        return default


# 推理前限制图片最大维度，防止高分辨率图片导致 OOM
MAX_IMAGE_DIM = _int_env("PATHO_MAX_IMAGE_DIM", 512)

# 最大生成 token 数
MAX_NEW_TOKENS = _int_env("PATHO_MAX_NEW_TOKENS", 1024)

# 单次推理超时（秒），防止模型挂起永久占用锁
INFERENCE_TIMEOUT_SECONDS = _int_env("PATHO_INFERENCE_TIMEOUT", 120)

# ---------------------------------------------------------------------------
#  提示词
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are Patho-R1, a pathology expert capable of analyzing histopathology images. "
    "Provide structured, step-by-step diagnostic reasoning. "
    "Use <think>...</think> for your reasoning process and <answer>...</answer> for the final diagnosis."
)

REPORT_PROMPT = (
    "Based on this pathology image, generate a structured diagnostic report with the following sections:\n"
    "1. **Diagnostic Conclusion**: Most likely pathological diagnosis\n"
    "2. **Key Findings**: Morphological features supporting the diagnosis (at least 3 points)\n"
    "3. **Grading/Staging**: If applicable (e.g., Gleason score, WHO grade, TNM staging)\n"
    "4. **Differential Diagnosis**: Other possibilities to rule out\n"
    "5. **Clinical Recommendations**: Further tests or follow-up suggestions"
)

# ---------------------------------------------------------------------------
#  服务监听
# ---------------------------------------------------------------------------

DEFAULT_HOST = os.environ.get("PATHO_HOST", "127.0.0.1")
DEFAULT_PORT = _int_env("PATHO_PORT", 8001)
