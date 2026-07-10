"""Launcher 服务管理器配置。

所有可配置项集中在此，支持通过环境变量覆盖，方便不同机器部署。
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
#  路径
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

# Python 解释器路径，可通过环境变量或 .env 覆盖
PYTHON = os.environ.get(
    "PYTHON_PATH",
    r"D:\miniconda3\envs\patho\python.exe",
)

# ---------------------------------------------------------------------------
#  服务定义
# ---------------------------------------------------------------------------

SERVICES = {
    "auth": {
        "label": "用户认证服务",
        "script": str(PROJECT_ROOT / "auth" / "server.py"),
        "args": [],
        "port": 8100,
    },
    "cellpose": {
        "label": "Cellpose 细胞分割",
        "script": str(PROJECT_ROOT / "cellpose" / "server.py"),
        "args": ["--model", "cyto3", "--port", "8002"],
        "port": 8002,
    },
    "patho": {
        "label": "Qwen2.5-VL 病理分析",
        "script": str(PROJECT_ROOT / "Patho-R1" / "server.py"),
        "args": ["--model", "qwen", "--port", "8001"],
        "port": 8001,
    },
}

# ---------------------------------------------------------------------------
#  服务监听
# ---------------------------------------------------------------------------

DEFAULT_HOST = os.environ.get("LAUNCHER_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("LAUNCHER_PORT", "8099"))

# 启动后等待后端服务就绪的最大秒数
STARTUP_TIMEOUT_SECONDS = int(os.environ.get("LAUNCHER_STARTUP_TIMEOUT", "120"))
