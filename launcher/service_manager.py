"""后端服务进程管理。

封装服务元数据、进程启停、健康检查和日志读取，供 Launcher FastAPI 层调用。
"""

import atexit
import asyncio
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .config import LOG_DIR, PYTHON, SERVICES
from .logger import setup_logger

logger = setup_logger("launcher", LOG_DIR)


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


class _ProcessHandle:
    """包装 subprocess.Popen 及其日志文件句柄，便于统一关闭。"""

    def __init__(self, proc: subprocess.Popen, log_file) -> None:
        self.proc = proc
        self.log_file = log_file

    def close_log(self) -> None:
        try:
            self.log_file.close()
        except Exception:
            pass


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
        self._processes: dict[str, _ProcessHandle] = {}
        # 程序退出时自动停止所有托管服务
        atexit.register(self.shutdown)

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
            handle = self._processes.get(name)
            alive = handle is not None and handle.proc.poll() is None
            healthy = self._is_port_open(svc.port)
            crashed = handle is not None and handle.proc.poll() is not None

            result[name] = {
                "label": svc.label,
                "running": alive or healthy,
                "healthy": healthy,
                "crashed": crashed,
                "exit_code": handle.proc.returncode if crashed else None,
                "port": svc.port,
            }
        return result

    def read_logs(self, name: str, lines: int = 50) -> dict:
        """读取指定服务的最近 N 行日志。"""
        svc = self.get(name)
        log_path = svc.log_path
        if not log_path.exists():
            return {"logs": "", "message": "暂无日志"}

        try:
            tail = self._read_tail(log_path, lines)
            total = self._count_lines(log_path)
            return {"logs": "\n".join(tail), "total_lines": total}
        except OSError as exc:
            logger.error(f"读取日志失败 {log_path}: {exc}")
            return {"logs": "", "message": f"读取日志失败: {exc}"}

    @staticmethod
    def _read_tail(path: Path, n: int) -> list[str]:
        """从文件末尾读取最近 n 行，避免大文件全量加载。"""
        # 简单实现：按块从后往前读，直到收集够 n 行或到达开头
        chunk_size = 8192
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            buffer = b""
            collected: list[bytes] = []
            pos = size
            while pos > 0 and len(collected) < n:
                read_size = min(chunk_size, pos)
                pos -= read_size
                f.seek(pos)
                chunk = f.read(read_size)
                buffer = chunk + buffer
                parts = buffer.split(b"\n")
                # 最后一段可能不完整，留到下一轮
                buffer = parts.pop(0) if pos > 0 else b""
                collected = parts + collected
            # 去掉可能的空行并限制数量
            result = [
                line.decode("utf-8", errors="replace").rstrip("\r")
                for line in collected
                if line
            ]
            return result[-n:] if len(result) > n else result

    @staticmethod
    def _count_lines(path: Path) -> int:
        """统计文件行数。"""
        count = 0
        with open(path, "rb") as f:
            for _ in f:
                count += 1
        return count

    # ------------------------------------------------------------------
    #  控制
    # ------------------------------------------------------------------

    async def start(self, name: str, wait: bool = True, timeout_seconds: int = 120) -> dict:
        """启动指定服务；若已运行则直接返回成功。"""
        svc = self.get(name)
        handle = self._processes.get(name)

        # 清理旧进程引用
        if handle is not None and handle.proc.poll() is not None:
            self._cleanup_finished(name)
            handle = None

        if handle is not None and handle.proc.poll() is None:
            return {"message": f"{svc.label} 已在运行"}

        log_file = self._open_log(svc)
        popen_kwargs: dict = {
            "stdout": log_file,
            "stderr": subprocess.STDOUT,
        }
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

        proc = subprocess.Popen(
            [PYTHON, "-u", str(svc.script), *svc.args],
            **popen_kwargs,
        )
        self._processes[name] = _ProcessHandle(proc, log_file)

        logger.info(f"启动 {svc.label} (pid={proc.pid}), 日志: {svc.log_path}")

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
            await asyncio.sleep(1)

        return {"message": f"{svc.label} 正在启动中，模型加载可能需要更长时间"}

    def stop(self, name: str) -> dict:
        """停止指定服务。"""
        svc = self.get(name)
        handle = self._processes.pop(name, None)

        if not handle or handle.proc.poll() is not None:
            if handle:
                handle.close_log()
            return {"message": f"{svc.label} 未在运行"}

        proc = handle.proc
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.warning(f"{svc.label} 未能在 5 秒内终止，执行 kill")
            proc.kill()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                logger.error(f"{svc.label} 无法被强制终止")
        finally:
            handle.close_log()
        return {"message": f"{svc.label} 已停止"}

    def start_all(self, delay_seconds: float = 1.0) -> None:
        """后台启动所有未运行的服务（用于 --auto-start）。"""
        time.sleep(delay_seconds)
        for name, svc in self._services.items():
            if self._is_port_open(svc.port):
                continue
            # 直接同步启动（wait=False 不需要 async sleep）
            handle = self._processes.get(name)
            if handle is not None and handle.proc.poll() is None:
                continue
            log_file = self._open_log(svc)
            popen_kwargs: dict = {"stdout": log_file, "stderr": subprocess.STDOUT}
            if sys.platform == "win32":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            proc = subprocess.Popen([PYTHON, "-u", str(svc.script), *svc.args], **popen_kwargs)
            self._processes[name] = _ProcessHandle(proc, log_file)
            logger.info(f"启动 {svc.label} (pid={proc.pid})")

    def shutdown(self) -> None:
        """停止所有托管的服务进程。"""
        if not self._processes:
            return
        try:
            logger.info("Launcher 正在停止所有托管服务...")
        except Exception:
            pass
        for name in list(self._processes.keys()):
            self.stop(name)
        try:
            logger.info("所有托管服务已停止")
        except Exception:
            pass

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
        handle = self._processes.pop(name, None)
        if handle is not None:
            handle.close_log()
