"""共享日志配置。

统一输出到控制台和按大小轮转的日志文件，供 Patho-R1、Cellpose、Launcher 三个服务复用。
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

    if logger.handlers:
        return logger

    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    logger.addHandler(console)

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
