"""密码哈希与 JWT 令牌管理。"""

import base64
import hashlib
import hmac
import json
import secrets
import time

from .config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET

PBKDF2_ITERATIONS = 600_000


def generate_salt() -> str:
    return secrets.token_hex(16)


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS
    ).hex()


def verify_password(password: str, salt: str, password_hash: str) -> bool:
    return hmac.compare_digest(hash_password(password, salt), password_hash)


def create_token(user_id: int, username: str) -> str:
    """创建简易 JWT（header.payload.signature）。"""
    header = _b64encode(json.dumps({"alg": JWT_ALGORITHM, "typ": "JWT"}))
    payload = _b64encode(json.dumps({
        "sub": str(user_id),
        "username": username,
        "exp": int(time.time()) + JWT_EXPIRE_HOURS * 3600,
        "iat": int(time.time()),
    }))
    signature = _b64encode(
        hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    )
    return f"{header}.{payload}.{signature}"


def verify_token(token: str) -> dict | None:
    """验证 JWT 并返回 payload，过期或无效返回 None。"""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, payload, signature = parts

        expected_sig = _b64encode(
            hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(signature, expected_sig):
            return None

        data = json.loads(_b64decode(payload))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


def _b64encode(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(data: str) -> str:
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data).decode()
