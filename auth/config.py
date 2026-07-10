"""认证服务配置。"""

import os
import secrets
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "auth.db"
DB_PATH.parent.mkdir(exist_ok=True)

DEFAULT_HOST = os.environ.get("AUTH_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("AUTH_PORT", "8100"))

JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    import warnings
    warnings.warn(
        "JWT_SECRET 未设置，使用随机密钥。重启后所有令牌将失效。"
        "请设置环境变量 JWT_SECRET 以持久化。",
        RuntimeWarning,
        stacklevel=2,
    )
    JWT_SECRET = secrets.token_hex(32)
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 7 * 24  # 7 天
