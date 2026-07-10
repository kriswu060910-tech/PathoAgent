"""后端服务进程管理。

封装服务元数据、进程启停、健康检查和日志读取，供 Launcher FastAPI 层调用。
"""

import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import LOG_DIR, PYTHON, SERVICES


@dataclass(frozen=True)
class Service:
    """单个后端服务的静态配置。"""

    name: str
    label: str
    script: Path
    args: list[str]
    port: int

    @property
    def log_path(self) -> Path:
        return LOG_DIR / f"{self.name}.log"


class ServiceManager:
    """管理后端服务的生命周期。"""

    def __init__(self) -> None:
        self._services: dict[str, Service] = {
            name: Service(
                name=name,
                label=cfg["label"],
                script=Path(cfg["script"]),
                args=cfg["args"],
                port=cfg["port"],
            )
            for name, cfg in SERVICES.items()
        }
        self._processes: dict[str, subprocess.Popen] = {}

    # ------------------------------------------------------------------
    #  查询
    # ------------------------------------------------------------------

    def list_names(self) -> list[str]:
        return list(self._services.keys())

    def get(self, name: str) -> Service:
        if name not in self._services:
            raise KeyError(f"Unknown service: {name}")
        return self._services[name]

    def status(self) -> dict[str, dict]:
        """只读查询所有服务状态，不修改内部进程表。"""
        result = {}
        for name, svc in self._services.items():
            proc = self._processes.get(name)
            alive = proc is not None and proc.poll() is None
            healthy = self._is_port_open(svc.port)
            crashed = proc is not None and proc.poll() is not None

            result[name] = {
                "label": svc.label,
                "running": alive or healthy,
                "healthy": healthy,
                "crashed": crashed,
                "exit_code": proc.returncode if crashed else None,
                "port": svc.port,
            }
        return result

    def read_logs(self, name: str, lines: int = 50) -> dict:
        """读取指定服务的最近 N 行日志。"""
        svc = self.get(name)
        log_path = svc.log_path
        if not log_path.exists():
            return {"logs": "", "message": "暂无日志"}

        content = log_path.read_text(encoding="utf-8")
        all_lines = content.splitlines()
        tail = all_lines[-lines:] if len(all_lines) > lines else all_lines
        return {"logs": "\n".join(tail), "total_lines": len(all_lines)}

    # ------------------------------------------------------------------
    #  控制
    # ------------------------------------------------------------------

    def start(self, name: str, wait: bool = True, timeout_seconds: int = 120) -> dict:
        """启动指定服务；若已运行则直接返回成功。"""
        svc = self.get(name)
        proc = self._processes.get(name)

        # 清理旧进程引用
        if proc is not None and proc.poll() is not None:
            self._cleanup_finished(name)
            proc = None

        if proc is not None and proc.poll() is None:
            return {"message": f"{svc.label} 已在运行"}

        log_file = self._open_log(svc)
        proc = subprocess.Popen(
            [PYTHON, "-u", str(svc.script), *svc.args],
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
        self._processes[name] = proc

        print(f"[Launcher] 启动 {svc.label} (pid={proc.pid}), 日志: {svc.log_path}")

        if not wait:
            return {"message": f"{svc.label} 正在启动中"}

        # 等待端口就绪
        for _ in range(timeout_seconds):
            if self._is_port_open(svc.port):
                return {"message": f"{svc.label} 启动成功"}
            if proc.poll() is not None:
                return {
                    "message": (
                        f"{svc.label} 启动失败（exit code {proc.returncode}），"
                        "请查看日志"
                    )
                }
            time.sleep(1)

        return {"message": f"{svc.label} 正在启动中，模型加载可能需要更长时间"}

    def stop(self, name: str) -> dict:
        """停止指定服务。"""
        svc = self.get(name)
        proc = self._processes.get(name)

        if not proc or proc.poll() is not None:
            # 进程不存在或已退出，清理残留引用
            self._processes.pop(name, None)
            return {"message": f"{svc.label} 未在运行"}

        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3)
        self._processes.pop(name, None)
        return {"message": f"{svc.label} 已停止"}

    def start_all(self, delay_seconds: float = 1.0) -> None:
        """后台启动所有未运行的服务（用于 --auto-start）。"""
        time.sleep(delay_seconds)
        for name, svc in self._services.items():
            if self._is_port_open(svc.port):
                continue
            self.start(name, wait=False)
            print(f"[Launcher] 正在启动 {svc.label} ...")

    def shutdown(self) -> None:
        """停止所有托管的服务进程。"""
        for name in list(self._processes.keys()):
            self.stop(name)

    # ------------------------------------------------------------------
    #  内部工具
    # ------------------------------------------------------------------

    @staticmethod
    def _is_port_open(port: int) -> bool:
        try:
            resp = urllib.request.urlopen(
                f"http://localhost:{port}/health", timeout=2
            )
            return resp.status == 200
        except Exception:
            return False

    @staticmethod
    def _open_log(svc: Service):
        """以服务名打开日志文件（追加模式），stdout/stderr 共用。"""
        return open(svc.log_path, "a", encoding="utf-8")

    def _cleanup_finished(self, name: str) -> None:
        """清理已结束进程在内部进程表中的残留引用。

        仅当进程已退出时才移除；若仍在运行则保留不动。
        """
        proc = self._processes.get(name)
        if proc is None:
            return
        if proc.poll() is not None:
            # 进程已退出，安全移除
            self._processes.pop(name, None)
        # 若 poll() is None（仍在运行），不做任何操作
