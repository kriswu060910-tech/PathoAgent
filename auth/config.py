"""认证服务配置。"""

import os
import secrets
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "auth.db"
DB_PATH.parent.mkdir(exist_ok=True)

DEFAULT_HOST = os.environ.get("AUTH_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("AUTH_PORT", "8100"))

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 7 * 24  # 7 天

# JWT 密钥：优先环境变量，其次从文件持久化读取/生成
_JWT_SECRET_FILE = DB_PATH.parent / ".jwt_secret"
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    if _JWT_SECRET_FILE.exists():
        JWT_SECRET = _JWT_SECRET_FILE.read_text(encoding="utf-8").strip()
    if not JWT_SECRET:
        JWT_SECRET = secrets.token_hex(32)
        _JWT_SECRET_FILE.write_text(JWT_SECRET, encoding="utf-8")
        try:
            # Unix: 仅所有者可读写; Windows chmod 仅设置只读属性，
            # 生产部署请通过 NTFS ACL (icacls) 进一步限制访问权限
            _JWT_SECRET_FILE.chmod(0o600)
        except OSError:
            pass

# 管理员密钥，注册时提供匹配的密钥才会创建管理员账户。
# 未设置时默认禁止管理员注册，避免空密钥导致所有用户都成为管理员。
ADMIN_KEY = os.environ.get("ADMIN_KEY") or None
if not ADMIN_KEY:
    import warnings
    warnings.warn(
        "ADMIN_KEY 未设置，管理员注册功能已禁用。"
        "如需注册管理员，请通过环境变量 ADMIN_KEY 设置非空管理员密钥。",
        RuntimeWarning,
        stacklevel=2,
    )
