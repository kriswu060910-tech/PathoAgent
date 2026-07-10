r"""服务启动管理器 — 供前端 UI 控制后端服务的启停。

启动方式：
  cd D:\agent
  D:\miniconda3\envs\patho\python.exe -m launcher.main

API 端点：
  GET  /status          查询所有服务状态
  GET  /logs/{name}     查看指定服务的最近日志
  POST /start/{name}    启动指定服务
  POST /stop/{name}     停止指定服务
"""

import argparse
import signal
import sys
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .logger import setup_logger
from .service_manager import ServiceManager

manager = ServiceManager()
logger = setup_logger("launcher", config.LOG_DIR)

app = FastAPI(title="Agent Launcher", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:4173",   # Vite preview
        "tauri://localhost",       # Tauri 生产环境
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/status")
async def status():
    return manager.status()


@app.get("/logs/{name}")
async def logs(name: str, lines: int = Query(default=50, ge=1, le=500)):
    try:
        return manager.read_logs(name, lines)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/start/{name}")
async def start(name: str):
    try:
        return await manager.start(name, timeout_seconds=config.STARTUP_TIMEOUT_SECONDS)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/stop/{name}")
async def stop(name: str):
    try:
        return manager.stop(name)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent Launcher")
    parser.add_argument(
        "--auto-start",
        action="store_true",
        help="启动时自动拉起所有后端服务",
    )
    args = parser.parse_args()

    if args.auto_start:
        threading.Thread(
            target=manager.start_all,
            kwargs={"delay_seconds": 1.0},
            daemon=True,
        ).start()

    if not Path(config.PYTHON).exists():
        logger.error(f"配置的 Python 解释器不存在: {config.PYTHON}")
        logger.error("请检查 PYTHON_PATH 环境变量或 launcher/config.py 配置")
        sys.exit(1)

    logger.info(
        f"Launcher 启动: host={config.DEFAULT_HOST}, port={config.DEFAULT_PORT}, "
        f"auto_start={args.auto_start}"
    )

    def _signal_handler(signum, _frame):
        sig_name = signal.Signals(signum).name
        logger.info(f"收到信号 {sig_name}，正在优雅关闭...")
        manager.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    import uvicorn

    uvicorn.run(app, host=config.DEFAULT_HOST, port=config.DEFAULT_PORT)
