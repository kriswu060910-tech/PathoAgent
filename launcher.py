r"""
服务启动管理器 — 供前端 UI 控制后端服务的启停。

启动方式：
  D:\miniconda3\envs\patho\python.exe D:\agent\launcher.py

API 端点：
  GET  /status          查询所有服务状态
  GET  /logs/{name}     查看指定服务的最近日志
  POST /start/{name}    启动指定服务
  POST /stop/{name}     停止指定服务
"""

import os
import subprocess
import time
import urllib.request
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

PROJECT_ROOT = Path(__file__).resolve().parent

PYTHON = os.environ.get("PYTHON_PATH", r"D:\miniconda3\envs\patho\python.exe")
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

SERVICES = {
    "cellpose": {
        "label": "Cellpose 细胞分割",
        "script": str(PROJECT_ROOT / "cellpose" / "server.py"),
        "args": ["--model", "cyto3", "--port", "8002"],
        "port": 8002,
    },
    "patho": {
        "label": "Qwen2.5-VL 病理分析",
        "script": str(PROJECT_ROOT / "Patho-R1" / "server.py"),
        "args": ["--model", "qwen", "--port", "8001"],
        "port": 8001,
    },
}

_processes: dict[str, subprocess.Popen] = {}

app = FastAPI(title="Agent Launcher", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_port_open(port: int) -> bool:
    try:
        resp = urllib.request.urlopen(f"http://localhost:{port}/health", timeout=2)
        return resp.status == 200
    except Exception:
        return False


def _open_log(name: str):
    """以服务名打开日志文件（追加模式），stdout/stderr 共用"""
    log_path = LOG_DIR / f"{name}.log"
    return open(log_path, "a", encoding="utf-8")


@app.get("/status")
async def status():
    result = {}
    for name, cfg in SERVICES.items():
        proc = _processes.get(name)
        alive = proc is not None and proc.poll() is None
        healthy = _is_port_open(cfg["port"])

        # 检测进程崩溃：进程存在但已退出
        crashed = False
        exit_code = None
        if proc is not None and proc.poll() is not None:
            exit_code = proc.returncode
            crashed = True
            del _processes[name]

        result[name] = {
            "label": cfg["label"],
            "running": alive or healthy,
            "healthy": healthy,
            "crashed": crashed,
            "exit_code": exit_code,
            "port": cfg["port"],
        }
    return result


@app.get("/logs/{name}")
async def logs(name: str, lines: int = 50):
    """返回指定服务最近 N 行日志"""
    if name not in SERVICES:
        raise HTTPException(404, f"Unknown service: {name}")

    log_path = LOG_DIR / f"{name}.log"
    if not log_path.exists():
        return {"logs": "", "message": "暂无日志"}

    content = log_path.read_text(encoding="utf-8")
    all_lines = content.splitlines()
    tail = all_lines[-lines:] if len(all_lines) > lines else all_lines
    return {"logs": "\n".join(tail), "total_lines": len(all_lines)}


@app.post("/start/{name}")
async def start(name: str):
    if name not in SERVICES:
        raise HTTPException(404, f"Unknown service: {name}")

    cfg = SERVICES[name]
    proc = _processes.get(name)
    if proc and proc.poll() is None:
        return {"message": f"{cfg['label']} 已在运行"}

    # 清理旧进程引用
    _processes.pop(name, None)

    log_file = _open_log(name)
    proc = subprocess.Popen(
        [PYTHON, "-u", cfg["script"], *cfg["args"]],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    _processes[name] = proc

    print(f"[Launcher] 启动 {cfg['label']} (pid={proc.pid}), 日志: {LOG_DIR / f'{name}.log'}")

    # 等待端口就绪（最多 120 秒，3B 模型加载较慢）
    for _ in range(120):
        if _is_port_open(cfg["port"]):
            return {"message": f"{cfg['label']} 启动成功"}
        # 检查进程是否已崩溃
        if proc.poll() is not None:
            return {"message": f"{cfg['label']} 启动失败（exit code {proc.returncode}），请查看日志"}
        time.sleep(1)

    return {"message": f"{cfg['label']} 正在启动中，模型加载可能需要更长时间"}


@app.post("/stop/{name}")
async def stop(name: str):
    if name not in SERVICES:
        raise HTTPException(404, f"Unknown service: {name}")

    proc = _processes.get(name)
    if not proc or proc.poll() is not None:
        _processes.pop(name, None)
        return {"message": f"{SERVICES[name]['label']} 未在运行"}

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    _processes.pop(name, None)
    return {"message": f"{SERVICES[name]['label']} 已停止"}


if __name__ == "__main__":
    import argparse as _ap
    import threading

    _parser = _ap.ArgumentParser()
    _parser.add_argument("--auto-start", action="store_true", help="启动时自动拉起所有后端服务")
    _args = _parser.parse_args()

    if _args.auto_start:
        def _boot():
            """后台线程：逐个启动后端服务，不阻塞 launcher 本身"""
            import time as _t
            _t.sleep(1)  # 等 uvicorn 就绪
            for name, cfg in SERVICES.items():
                if _is_port_open(cfg["port"]):
                    continue
                log_file = _open_log(name)
                proc = subprocess.Popen(
                    [PYTHON, "-u", cfg["script"], *cfg["args"]],
                    stdout=log_file,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
                )
                _processes[name] = proc
                print(f"[Launcher] 正在启动 {cfg['label']} (pid={proc.pid}) ...")
        threading.Thread(target=_boot, daemon=True).start()

    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8099)
