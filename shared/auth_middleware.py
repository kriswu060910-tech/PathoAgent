"""服务间统一认证中间件。

各后端服务（launcher、cellpose、Patho-R1、auth 管理端点）通过环境变量
``SERVICE_API_KEY`` 共享同一个 Bearer Token。未配置时不拦截请求（仅打印
警告），便于开发调试；生产环境务必设置强密钥。
"""

import os
import secrets
import warnings

from fastapi import HTTPException, Request

_SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY", "")


def get_service_api_key() -> str:
    """返回当前配置的 Service API Key；未配置时返回空字符串。"""
    return _SERVICE_API_KEY


def require_service_key() -> None:
    """供非请求上下文（如启动时检查）使用的校验函数。"""
    if not _SERVICE_API_KEY:
        warnings.warn(
            "SERVICE_API_KEY 未设置，服务间通信未加密认证。"
            "生产环境请设置强随机密钥。",
            RuntimeWarning,
            stacklevel=2,
        )


def require_service_token(request: Request) -> None:
    """FastAPI 依赖：校验请求头中的 ``Authorization: Bearer <SERVICE_API_KEY>``。

    当 ``SERVICE_API_KEY`` 为空时跳过校验（开发模式）。
    """
    if not _SERVICE_API_KEY:
        # 开发模式下放行，但已在模块导入时打印警告
        return

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供认证令牌")

    token = auth[7:]
    # 使用 secrets.compare_digest 防时序攻击
    if not secrets.compare_digest(token, _SERVICE_API_KEY):
        raise HTTPException(status_code=401, detail="认证令牌无效")


def generate_service_key() -> str:
    """生成一个安全的 256-bit Service API Key。"""
    return secrets.token_urlsafe(32)
