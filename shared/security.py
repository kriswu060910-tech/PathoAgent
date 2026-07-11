"""通用安全工具。

提供简单的内存型速率限制，适用于无外部依赖的单机/小型部署。
生产环境如需分布式限流，请替换为 Redis 等共享存储方案。
"""

import time
from collections import defaultdict
from functools import wraps


class RateLimiter:
    """基于滑动窗口的简单内存速率限制器。

    Args:
        max_requests: 窗口内允许的最大请求数。
        window_seconds: 窗口大小（秒）。
        key_func: 从请求对象提取限流键的函数，返回 None 时不限流。
    """

    def __init__(self, max_requests: int, window_seconds: int, key_func):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.key_func = key_func
        self._windows: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str | None) -> bool:
        if key is None:
            return True
        now = time.time()
        window = self._windows[key]
        # 清理过期记录
        cutoff = now - self.window_seconds
        while window and window[0] < cutoff:
            window.pop(0)
        if len(window) >= self.max_requests:
            return False
        window.append(now)
        return True

    def check(self, request) -> bool:
        return self.is_allowed(self.key_func(request))


def client_ip(request) -> str:
    """从请求对象中提取客户端 IP。

    服务绑定 127.0.0.1，无受信反向代理，不读取 X-Forwarded-For（可被伪造）。
    """
    return request.client.host if request.client else "unknown"


def _login_key(req) -> str:
    """提取限流键：仅基于 IP（请求体已被 Pydantic 消费，不可重复读取）。"""
    return f"login:{client_ip(req)}"


# 登录端点限流：每账号每 15 分钟最多 5 次失败
_login_limiter = RateLimiter(
    max_requests=5,
    window_seconds=15 * 60,
    key_func=_login_key,
)


def check_login_rate(request) -> bool:
    """检查登录请求是否超过速率限制。"""
    return _login_limiter.check(request)
