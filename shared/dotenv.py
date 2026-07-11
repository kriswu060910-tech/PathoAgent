"""轻量 .env 文件加载器，不依赖第三方库。"""

import os
from pathlib import Path


def load_dotenv(path: Path) -> None:
    """从 .env 文件加载环境变量（不覆盖已有值）。"""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if value and key not in os.environ:
            os.environ[key] = value
