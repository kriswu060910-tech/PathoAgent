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
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .logger import setup_logger
from .service_manager import ServiceManager

manager = ServiceManager()
logger = setup_logger("launcher", config.LOG_DIR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期事件：自动启动服务 + 优雅关闭。"""
    if _AUTO_START:
        asyncio.create_task(manager.start_all(delay_seconds=1.0))
    yield
    manager.shutdown()


app = FastAPI(title="Agent Launcher", version="1.0.0", lifespan=lifespan)

_cors_origins = os.environ.get(
    "LAUNCHER_CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,tauri://localhost,http://tauri.localhost",
)
allow_origins = [origin.strip() for origin in _cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


_AUTO_START = False


def _verify_service_token(request: Request) -> None:
    """校验 Bearer Token 与 SERVICE_API_KEY 一致，写操作必须。"""
    import hmac
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "缺少认证令牌")
    token = auth[7:]
    if not hmac.compare_digest(token, config.SERVICE_API_KEY):
        raise HTTPException(403, "认证令牌无效")


@app.get("/status")
async def status():
    data = await manager.status()
    data["service_api_key"] = config.SERVICE_API_KEY
    return data


@app.get("/logs/{name}")
async def logs(name: str, lines: int = Query(default=50, ge=1, le=500)):
    try:
        return manager.read_logs(name, lines)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/start/{name}")
async def start(name: str, request: Request):
    _verify_service_token(request)
    try:
        return await manager.start(name, timeout_seconds=config.STARTUP_TIMEOUT_SECONDS)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/stop/{name}")
async def stop(name: str, request: Request):
    _verify_service_token(request)
    try:
        return await manager.stop(name)
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
async def setup_select(req: dict, request: Request):
    _verify_service_token(request)
    import subprocess

    python_path = req.get("pythonPath", "")
    if not python_path:
        raise HTTPException(400, "未指定 Python 路径")
    from pathlib import Path as _Path
    if not _Path(python_path).exists():
        raise HTTPException(400, f"Python 路径不存在: {python_path}")

    # 验证是否为有效的 Python 解释器
    try:
        result = subprocess.run(
            [python_path, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if result.returncode != 0:
            raise HTTPException(400, f"无法执行 Python: {python_path}")
    except (OSError, subprocess.TimeoutExpired):
        raise HTTPException(400, f"无法执行 Python: {python_path}")

    config.save_python_path(python_path)
    config.PYTHON = python_path
    logger.info(f"用户选择 Python 环境: {python_path}")
    return {"ok": True, "message": f"已保存 Python 路径: {python_path}"}


@app.post("/setup/install")
async def setup_install(req: dict, request: Request):
    _verify_service_token(request)
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

    import uvicorn

    uvicorn.run(app, host=config.DEFAULT_HOST, port=config.DEFAULT_PORT)
