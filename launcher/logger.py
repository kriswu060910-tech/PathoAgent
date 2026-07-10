"""Launcher 日志配置。

统一输出到控制台和按大小轮转的日志文件，便于排查问题。
"""

import logging
import logging.handlers
import sys
from pathlib import Path


LOG_FORMAT = "[%(asctime)s][%(name)s][%(levelname)s] %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logger(name: str, log_dir: Path, level: int = logging.INFO) -> logging.Logger:
    """创建并配置一个同时写入控制台和轮转日志文件的 logger。"""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # 避免重复添加 handler（如模块被多次导入或在测试中重载）
    if logger.handlers:
        return logger

    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    # 控制台输出
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    logger.addHandler(console)

    # 文件输出（按大小轮转，单个 10MB，保留 5 个备份）
    log_dir.mkdir(parents=True, exist_ok=True)
    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / f"{name}.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger
