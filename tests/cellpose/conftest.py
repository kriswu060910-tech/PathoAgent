"""为 Cellpose 测试注入模块搜索路径。"""

import sys
from pathlib import Path

_MODULE_ROOT = Path(__file__).resolve().parent.parent.parent / "cellpose"
if str(_MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(_MODULE_ROOT))
