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
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .service_manager import ServiceManager

manager = ServiceManager()

app = FastAPI(title="Agent Launcher", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/status")
async def status():
    return manager.status()


@app.get("/logs/{name}")
async def logs(name: str, lines: int = 50):
    try:
        return manager.read_logs(name, lines)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/start/{name}")
async def start(name: str):
    try:
        return manager.start(name, timeout_seconds=config.STARTUP_TIMEOUT_SECONDS)
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

    import uvicorn

    uvicorn.run(app, host=config.DEFAULT_HOST, port=config.DEFAULT_PORT)
