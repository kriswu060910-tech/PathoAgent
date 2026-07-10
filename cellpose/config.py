"""Cellpose 后端配置。

所有可配置项集中在此，支持通过环境变量覆盖，方便不同机器部署。
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
#  模型
# ---------------------------------------------------------------------------

# 模型文件本地缓存目录，避免默认放到用户目录下
CELLPOSE_LOCAL_MODELS_PATH = Path(
    os.environ.get("CELLPOSE_LOCAL_MODELS_PATH", r"D:\cellpose\models")
)

MODEL_TYPES = ["cyto3", "nuclei", "tissuenet", "livecell", "cyto2", "cyto"]

DEFAULT_MODEL_TYPE = os.environ.get("CELLPOSE_MODEL_TYPE", "cyto3")

# ---------------------------------------------------------------------------
#  分割默认参数
# ---------------------------------------------------------------------------

DEFAULT_DIAMETER = None  # None 表示自动估计
DEFAULT_FLOW_THRESHOLD = 0.4
DEFAULT_CELLPROB_THRESHOLD = 0.0
DEFAULT_CHANNELS = [0, 0]

# ---------------------------------------------------------------------------
#  可视化参数
# ---------------------------------------------------------------------------

OVERLAY_ALPHA = 0.3
CONTOUR_COLOR = (255, 255, 0)
LABEL_FONT = 0.35
LABEL_THICKNESS = 1
MAX_DISPLAY_CELLS = 50

# ---------------------------------------------------------------------------
#  服务监听
# ---------------------------------------------------------------------------

DEFAULT_HOST = os.environ.get("CELLPOSE_HOST", "0.0.0.0")
DEFAULT_PORT = int(os.environ.get("CELLPOSE_PORT", "8002"))
