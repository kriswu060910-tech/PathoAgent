"""Patho-R1 日志配置 — 复用共享模块。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shared_logger import setup_logger, LOG_FORMAT, DATE_FORMAT  # noqa: E402

__all__ = ["setup_logger", "LOG_FORMAT", "DATE_FORMAT"]
