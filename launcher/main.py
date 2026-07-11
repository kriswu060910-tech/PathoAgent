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
import asyncio
import hmac
import os
import signal
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# Launcher token 认证：通过环境变量 LAUNCHER_TOKEN 设置
_LAUNCHER_TOKEN = os.environ.get("LAUNCHER_TOKEN", "")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if _LAUNCHER_TOKEN and request.url.path not in ("/health", "/docs", "/openapi.json"):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], _LAUNCHER_TOKEN):
            return JSONResponse(status_code=401, content={"detail": "未授权"})
    return await call_next(request)


_AUTO_START = False


@app.on_event("startup")
async def _auto_start_services():
    if _AUTO_START:
        asyncio.create_task(manager.start_all(delay_seconds=1.0))


@app.get("/status")
async def status():
    return await manager.status()


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


# --- 环境 Setup 端点 ---

@app.get("/setup/environments")
async def setup_environments():
    import asyncio
    from .env_scanner import scan_environments, env_to_dict, get_all_deps_flat
    envs = await asyncio.to_thread(scan_environments)
    return {
        "environments": [env_to_dict(e) for e in envs],
        "current_python": config.PYTHON,
        "all_deps": get_all_deps_flat(),
    }


@app.post("/setup/select")
async def setup_select(req: dict):
    python_path = req.get("pythonPath", "")
    if not python_path:
        raise HTTPException(400, "未指定 Python 路径")
    from pathlib import Path as _Path
    if not _Path(python_path).exists():
        raise HTTPException(400, f"Python 路径不存在: {python_path}")
    config.save_python_path(python_path)
    logger.info(f"用户选择 Python 环境: {python_path}")
    return {"ok": True, "message": f"已保存 Python 路径: {python_path}"}


@app.post("/setup/install")
async def setup_install(req: dict):
    import asyncio
    import re
    python_path = req.get("pythonPath", "")
    packages = req.get("packages", [])
    if not python_path:
        raise HTTPException(400, "未指定 Python 路径")
    from pathlib import Path as _Path
    if not _Path(python_path).exists():
        raise HTTPException(400, f"Python 路径不存在: {python_path}")
    if not packages or not isinstance(packages, list):
        raise HTTPException(400, "未指定要安装的包")
    # 校验包名：只允许合法 pip 包名字符
    for pkg in packages:
        if not isinstance(pkg, str) or not re.match(r'^[a-zA-Z0-9_][a-zA-Z0-9._-]*$', pkg):
            raise HTTPException(400, f"无效的包名: {pkg}")

    from .env_scanner import install_packages

    def _run_install():
        proc = install_packages(python_path, packages)
        output_lines: list[str] = []
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                output_lines.append(line)
        proc.wait(timeout=300)
        return {
            "ok": proc.returncode == 0,
            "output": "\n".join(output_lines[-50:]),
            "exit_code": proc.returncode,
        }

    return await asyncio.to_thread(_run_install)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent Launcher")
    parser.add_argument(
        "--auto-start",
        action="store_true",
        help="启动时自动拉起所有后端服务",
    )
    args = parser.parse_args()

    _AUTO_START = args.auto_start

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
