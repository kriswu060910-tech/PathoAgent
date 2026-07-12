"""共享工具包。"""

import os


def int_env(key: str, default: int) -> int:
    """安全地读取整数类型环境变量，格式错误时返回默认值。"""
    try:
        return int(os.environ.get(key, default))
    except (ValueError, TypeError):
        return default
