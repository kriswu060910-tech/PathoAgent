"""测试全局配置。"""

import logging

# 测试环境中 stdout 可能在测试结束后被关闭，避免 logging handler 报错
logging.raiseExceptions = False
