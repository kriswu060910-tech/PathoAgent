"""Launcher 服务管理器配置。

所有可配置项集中在此，支持通过环境变量覆盖，方便不同机器部署。
"""

import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
#  路径
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

# Python 解释器路径，可通过环境变量覆盖
def _resolve_python() -> str:
    # 1. 环境变量（最高优先级）
    env = os.environ.get("PYTHON_PATH", "")
    if env and Path(env).exists():
        return env

    # 2. 常见 conda 路径（快速 fallback，不触发扫描）
    candidates = [
        r"D:\miniconda3\envs\patho\python.exe",
        r"D:\Anaconda3\envs\patho\python.exe",
        r"C:\miniconda3\envs\patho\python.exe",
        r"C:\ProgramData\miniconda3\envs\patho\python.exe",
    ]
    for p in candidates:
        if Path(p).exists():
            return p

    # 3. 当前 Python
    return sys.executable

PYTHON = _resolve_python()


def _read_env_file() -> list[str]:
    """读取项目根目录 .env 文件，若不存在则返回空列表。"""
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        return env_file.read_text(encoding="utf-8").splitlines()
    return []


def _write_env_file(lines: list[str]) -> None:
    """原子地写入项目根目录 .env 文件。"""
    env_file = PROJECT_ROOT / ".env"
    tmp = env_file.with_suffix(".tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    tmp.replace(env_file)


def save_python_path(python_path: str) -> None:
    """将选定的 Python 路径写入 .env 文件。"""
    lines = _read_env_file()
    found = False
    for i, line in enumerate(lines):
        if line.strip().startswith("PYTHON_PATH="):
            lines[i] = f"PYTHON_PATH={python_path}"
            found = True
            break
    if not found:
        lines.append(f"PYTHON_PATH={python_path}")
    _write_env_file(lines)


def save_service_key(service_key: str) -> None:
    """将 Service API Key 写入 .env 文件。"""
    lines = _read_env_file()
    found = False
    for i, line in enumerate(lines):
        if line.strip().startswith("SERVICE_API_KEY="):
            lines[i] = f"SERVICE_API_KEY={service_key}"
            found = True
            break
    if not found:
        lines.append(f"SERVICE_API_KEY={service_key}")
    _write_env_file(lines)


def _resolve_service_key() -> str:
    """解析 Service API Key；未设置时自动生成并持久化到 .env。"""
    import secrets

    env = os.environ.get("SERVICE_API_KEY", "")
    if env:
        return env

    key = secrets.token_urlsafe(32)
    save_service_key(key)
    return key


SERVICE_API_KEY = _resolve_service_key()


# ---------------------------------------------------------------------------
#  .env 加载（从项目根目录读取，不覆盖已有环境变量）
# ---------------------------------------------------------------------------

from shared.dotenv import load_dotenv as _load_dotenv

_load_dotenv(PROJECT_ROOT / ".env")

# ---------------------------------------------------------------------------
#  服务定义
# ---------------------------------------------------------------------------

_auth_env = {"SERVICE_API_KEY": SERVICE_API_KEY}
_admin_key = os.environ.get("ADMIN_KEY", "")
if _admin_key:
    _auth_env["ADMIN_KEY"] = _admin_key

SERVICES = {
    "auth": {
        "label": "用户认证服务",
        "script": str(PROJECT_ROOT / "auth" / "server.py"),
        "args": [],
        "port": 8100,
        "env": _auth_env,
    },
    "cellpose": {
        "label": "Cellpose 细胞分割",
        "script": str(PROJECT_ROOT / "cellpose" / "server.py"),
        "args": ["--model", "cyto3", "--port", "8002"],
        "port": 8002,
        "env": {"SERVICE_API_KEY": SERVICE_API_KEY},
    },
    "patho": {
        "label": "Qwen2.5-VL 病理分析",
        "script": str(PROJECT_ROOT / "Patho-R1" / "server.py"),
        "args": ["--model", "qwen", "--port", "8001"],
        "port": 8001,
        "env": {"SERVICE_API_KEY": SERVICE_API_KEY},
    },
}

# ---------------------------------------------------------------------------
#  服务监听
# ---------------------------------------------------------------------------


def _int_env(key: str, default: int) -> int:
    """安全地读取整数类型环境变量，格式错误时返回默认值。"""
    try:
        return int(os.environ.get(key, default))
    except (ValueError, TypeError):
        return default


DEFAULT_HOST = os.environ.get("LAUNCHER_HOST", "127.0.0.1")
DEFAULT_PORT = _int_env("LAUNCHER_PORT", 8099)

# 启动后等待后端服务就绪的最大秒数
STARTUP_TIMEOUT_SECONDS = _int_env("LAUNCHER_STARTUP_TIMEOUT", 120)
