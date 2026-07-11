"""后端服务进程管理。

封装服务元数据、进程启停、健康检查和日志读取，供 Launcher FastAPI 层调用。
"""

import atexit
import asyncio
import os
import signal
import subprocess
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .config import LOG_DIR, PROJECT_ROOT, PYTHON, SERVICES
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
    env: dict[str, str] | None = None

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
                env=cfg.get("env"),
            )
            for name, cfg in SERVICES.items()
        }
        self._processes: dict[str, _ProcessHandle] = {}
        self._lock = asyncio.Lock()
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

    async def status(self) -> dict[str, dict]:
        """只读查询所有服务状态，不修改内部进程表。"""
        async with self._lock:
            names = list(self._services.keys())
            ports = [self._services[name].port for name in names]
            health_results = await asyncio.gather(
                *(self._is_port_open(port) for port in ports)
            )

            result = {}
            for name, healthy in zip(names, health_results):
                svc = self._services[name]
                handle = self._processes.get(name)
                alive = handle is not None and handle.proc.poll() is None
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
            tail, total = self._read_tail_with_count(log_path, lines)
            return {"logs": "\n".join(tail), "total_lines": total}
        except OSError as exc:
            logger.error(f"读取日志失败 {log_path}: {exc}")
            return {"logs": "", "message": f"读取日志失败: {exc}"}

    @staticmethod
    def _read_tail_with_count(path: Path, n: int) -> tuple[list[str], int]:
        """从文件末尾读取最近 n 行，同时统计总行数，避免二次扫描。"""
        chunk_size = 8192
        total_lines = 0
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
                buffer = parts.pop(0) if pos > 0 else b""
                collected = parts + collected
            # 统计总行数：已收集的行数 + 剩余前缀中的换行数
            total_lines = len(collected)
            if buffer:
                total_lines += buffer.count(b"\n")
            # 继续统计文件剩余前缀部分的行数
            if pos > 0:
                f.seek(0)
                remaining = pos
                while remaining > 0:
                    read_size = min(chunk_size, remaining)
                    total_lines += f.read(read_size).count(b"\n")
                    remaining -= read_size
            result = [
                line.decode("utf-8", errors="replace").rstrip("\r")
                for line in collected
                if line
            ]
            return (result[-n:] if len(result) > n else result, total_lines)

    # ------------------------------------------------------------------
    #  控制
    # ------------------------------------------------------------------

    @staticmethod
    def _build_env(svc: Service) -> dict[str, str]:
        """合并当前环境变量、PYTHONPATH（含项目根目录）与服务自定义变量。"""
        merged = dict(os.environ)
        root = str(PROJECT_ROOT)
        existing = merged.get("PYTHONPATH", "")
        if root not in existing.split(os.pathsep):
            merged["PYTHONPATH"] = root + (os.pathsep + existing if existing else "")
        if svc.env:
            merged.update(svc.env)
        return merged

    @staticmethod
    def _module_args(svc: Service) -> list[str]:
        """构造服务启动命令。

        若服务脚本位于 Python 包内（有 __init__.py），使用 python -m 方式启动以支持相对导入；
        否则直接运行脚本文件。
        """
        script_dir = svc.script.parent
        if (script_dir / "__init__.py").exists():
            rel = svc.script.resolve().relative_to(PROJECT_ROOT.resolve())
            module = str(rel.with_suffix("")).replace(os.sep, ".")
            return [PYTHON, "-u", "-m", module, *svc.args]
        return [PYTHON, "-u", str(svc.script), *svc.args]

    async def start(self, name: str, wait: bool = True, timeout_seconds: int = 120) -> dict:
        """启动指定服务；若已运行则直接返回成功。"""
        async with self._lock:
            return await self._start_unlocked(name, wait, timeout_seconds)

    async def _start_unlocked(
        self, name: str, wait: bool = True, timeout_seconds: int = 120
    ) -> dict:
        """在锁保护下启动指定服务。"""
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
        env = self._build_env(svc)
        if env is not None:
            popen_kwargs["env"] = env
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = (
                subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000  # CREATE_NO_WINDOW
            )

        proc = subprocess.Popen(
            self._module_args(svc),
            **popen_kwargs,
        )
        self._processes[name] = _ProcessHandle(proc, log_file)

        logger.info(f"启动 {svc.label} (pid={proc.pid}), 日志: {svc.log_path}")

        if not wait:
            return {"message": f"{svc.label} 正在启动中"}

        # 等待端口就绪
        for _ in range(timeout_seconds):
            if await self._is_port_open(svc.port):
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

    async def stop(self, name: str) -> dict:
        """停止指定服务。"""
        async with self._lock:
            return await self._stop_unlocked(name)

    async def _stop_unlocked(self, name: str) -> dict:
        """在锁保护下停止指定服务。"""
        svc = self.get(name)
        handle = self._processes.pop(name, None)

        if not handle or handle.proc.poll() is not None:
            if handle:
                handle.close_log()
            return {"message": f"{svc.label} 未在运行"}

        proc = handle.proc
        try:
            await asyncio.to_thread(self._terminate_process, proc)
        finally:
            handle.close_log()
        return {"message": f"{svc.label} 已停止"}

    async def start_all(self, delay_seconds: float = 1.0) -> None:
        """后台启动所有未运行的服务（用于 --auto-start）。"""
        await asyncio.sleep(delay_seconds)
        async with self._lock:
            started_names: list[str] = []
            for name, svc in self._services.items():
                if await self._is_port_open(svc.port):
                    continue
                handle = self._processes.get(name)
                if handle is not None and handle.proc.poll() is None:
                    continue
                await self._start_unlocked(name, wait=False)
                started_names.append(name)

            if not started_names:
                return

            await asyncio.sleep(3)

            ports = [self._services[name].port for name in started_names]
            health_results = await asyncio.gather(
                *(self._is_port_open(port) for port in ports)
            )

            for name, healthy in zip(started_names, health_results):
                svc = self._services[name]
                handle = self._processes.get(name)
                if not handle:
                    continue
                if healthy:
                    logger.info(f"{svc.label} 健康检查通过")
                    continue
                exit_code = handle.proc.poll()
                if exit_code is not None:
                    logger.error(
                        f"{svc.label} 启动失败 (exit code {exit_code})，请查看日志"
                    )
                    self._cleanup_finished(name)
                else:
                    logger.warning(f"{svc.label} 尚未通过健康检查")

    def shutdown(self) -> None:
        """停止所有托管的服务进程。"""
        if not self._processes:
            return
        try:
            logger.info("Launcher 正在停止所有托管服务...")
        except Exception:
            pass
        for name in list(self._processes.keys()):
            handle = self._processes.pop(name, None)
            if not handle:
                continue
            if handle.proc.poll() is None:
                self._terminate_process(handle.proc)
            handle.close_log()
        try:
            logger.info("所有托管服务已停止")
        except Exception:
            pass

    # ------------------------------------------------------------------
    #  内部工具
    # ------------------------------------------------------------------

    @staticmethod
    def _terminate_process(proc: subprocess.Popen) -> None:
        """终止单个进程；Windows 发送 CTRL_BREAK_EVENT，超时后 taskkill。"""
        if sys.platform == "win32":
            try:
                os.kill(proc.pid, signal.CTRL_BREAK_EVENT)
                proc.wait(timeout=5)
            except (ProcessLookupError, OSError, subprocess.TimeoutExpired):
                pass
            if proc.poll() is None:
                logger.warning(f"进程 {proc.pid} 未能在 5 秒内终止，执行 taskkill")
                subprocess.run(
                    ["taskkill", "/T", "/F", "/PID", str(proc.pid)], check=False
                )
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    logger.error(f"进程 {proc.pid} 无法被强制终止")
        else:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning(f"进程 {proc.pid} 未能在 5 秒内终止，执行 kill")
                proc.kill()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    logger.error(f"进程 {proc.pid} 无法被强制终止")

    @staticmethod
    async def _is_port_open(port: int) -> bool:
        def _check() -> bool:
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/health", timeout=2
                ) as resp:
                    return resp.status == 200
            except Exception:
                return False

        return await asyncio.to_thread(_check)

    @staticmethod
    def _open_log(svc: Service):
        """以服务名打开日志文件（追加模式），stdout/stderr 共用。

        若日志超过 10MB，则滚动备份为 xxx.log.1。
        """
        LOG_MAX_BYTES = 10 * 1024 * 1024
        log_path = svc.log_path
        if log_path.exists() and log_path.stat().st_size > LOG_MAX_BYTES:
            backup = log_path.with_suffix(log_path.suffix + ".1")
            if backup.exists():
                backup.unlink()
            log_path.rename(backup)
        return open(log_path, "a", encoding="utf-8")

    def _cleanup_finished(self, name: str) -> None:
        """清理已结束进程在内部进程表中的残留引用。

        仅当进程已退出时才移除；若仍在运行则保留不动。
        """
        handle = self._processes.pop(name, None)
        if handle is not None:
            handle.close_log()
