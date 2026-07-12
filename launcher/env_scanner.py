"""Python 环境扫描与依赖检测。

扫描系统中可用的 Python 环境（conda、系统 Python），检测各服务所需依赖的安装状态，
为前端 Setup 向导和 ServicePanel 环境选择提供数据。
"""

import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .logger import setup_logger

logger = setup_logger("launcher", Path(__file__).resolve().parent.parent / "logs")

# 各服务所需的关键第三方包（pip 包名 → import 名）
SERVICE_DEPS: dict[str, dict[str, str]] = {
    "common": {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "pillow": "PIL",
    },
    "patho": {
        "torch": "torch",
        "transformers": "transformers",
        "bitsandbytes": "bitsandbytes",
        "accelerate": "accelerate",
    },
    "cellpose": {
        "torch": "torch",
        "cellpose": "cellpose",
        "opencv-python": "cv2",
        "numpy": "numpy",
    },
    "auth": {
        "fastapi": "fastapi",
        "pydantic": "pydantic",
    },
}


@dataclass
class PythonEnv:
    """一个可用的 Python 环境。"""
    path: str
    version: str
    is_conda: bool
    env_name: str
    packages: dict[str, bool] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    has_cuda: bool = False
    score: int = 0


def _run(cmd: list[str], timeout: int = 10) -> tuple[bool, str]:
    """执行命令并返回 (成功, stdout)。"""
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000) if sys.platform == "win32" else 0,
        )
        return r.returncode == 0, r.stdout
    except Exception:
        return False, ""


def _get_python_version(python_path: str) -> str:
    ok, out = _run([python_path, "--version"])
    if ok and "Python" in out:
        return out.strip().split()[-1]
    return ""


def _check_packages(python_path: str, pkg_map: dict[str, str]) -> tuple[dict[str, bool], list[str]]:
    """在目标 Python 环境中检测包是否可导入。"""
    packages: dict[str, bool] = {}
    missing: list[str] = []
    for pip_name, import_name in pkg_map.items():
        code = f"import {import_name}; print({import_name}.__version__ if hasattr({import_name}, '__version__') else 'ok')"
        ok, out = _run([python_path, "-c", code], timeout=15)
        packages[pip_name] = ok
        if not ok:
            missing.append(pip_name)
    return packages, missing


def _check_cuda(python_path: str) -> bool:
    """检测 PyTorch CUDA 是否可用。"""
    code = "import torch; print(torch.cuda.is_available() and torch.cuda.device_count() > 0)"
    ok, out = _run([python_path, "-c", code], timeout=15)
    return ok and "True" in out


def _find_conda_envs() -> list[str]:
    """查找 conda 环境中的 Python 路径。"""
    envs: list[str] = []

    # 方式 1: conda env list
    ok, out = _run(["conda", "env", "list", "--json"])
    if ok:
        try:
            data = json.loads(out)
            for env_path in data.get("envs", []):
                python = Path(env_path) / "python.exe" if sys.platform == "win32" else Path(env_path) / "bin" / "python"
                if python.exists():
                    envs.append(str(python))
        except json.JSONDecodeError:
            pass

    # 方式 2: 文件系统扫描常见 conda 安装位置
    conda_roots = []
    if sys.platform == "win32":
        candidates = [
            Path(r"D:\miniconda3"),
            Path(r"D:\Anaconda3"),
            Path(r"C:\miniconda3"),
            Path(r"C:\ProgramData\miniconda3"),
            Path(r"C:\ProgramData\Anaconda3"),
        ]
        for c in candidates:
            if c.exists():
                conda_roots.append(c)
        # 用户目录
        userprofile = os.environ.get("USERPROFILE", "")
        if userprofile:
            for name in ["miniconda3", "Anaconda3"]:
                p = Path(userprofile) / name
                if p.exists():
                    conda_roots.append(p)
    else:
        home = Path.home()
        for name in ["miniconda3", "anaconda3"]:
            p = home / name
            if p.exists():
                conda_roots.append(p)

    for root in conda_roots:
        envs_dir = root / "envs"
        if envs_dir.is_dir():
            for env_dir in envs_dir.iterdir():
                if env_dir.is_dir():
                    python = env_dir / "python.exe" if sys.platform == "win32" else env_dir / "bin" / "python"
                    python_str = str(python)
                    if python.exists() and python_str not in envs:
                        envs.append(python_str)

    return envs


def _find_system_pythons() -> list[str]:
    """查找系统 Python 路径。"""
    pythons: list[str] = []

    if sys.platform == "win32":
        ok, out = _run(["where", "python"])
        if ok:
            for line in out.strip().splitlines():
                p = line.strip()
                if p and "WindowsApps" not in p and p not in pythons:
                    pythons.append(p)
    else:
        for cmd in ["python3", "python"]:
            ok, out = _run(["which", cmd])
            if ok and out.strip() and out.strip() not in pythons:
                pythons.append(out.strip())

    return pythons


def _compute_score(env: PythonEnv) -> int:
    """计算环境评分：依赖越完整分越高。"""
    all_deps: dict[str, str] = {}
    for deps in SERVICE_DEPS.values():
        all_deps.update(deps)

    total = len(all_deps)
    if total == 0:
        return 0

    installed = sum(1 for v in env.packages.values() if v)
    base_score = int((installed / total) * 100)

    # conda 环境加分
    if env.is_conda:
        base_score += 10
    # CUDA 加分
    if env.has_cuda:
        base_score += 20
    # patho 和 cellpose 的核心依赖都在才加分
    patho_ok = all(env.packages.get(p, False) for p in SERVICE_DEPS["patho"])
    cellpose_ok = all(env.packages.get(p, False) for p in SERVICE_DEPS["cellpose"])
    if patho_ok:
        base_score += 15
    if cellpose_ok:
        base_score += 15

    return base_score


def _get_env_name(python_path: str) -> str:
    """从路径推断环境名。"""
    p = Path(python_path)
    # conda 环境: .../envs/<name>/python.exe
    if p.parent.parent.name == "envs":
        return p.parent.name
    # base conda
    if p.parent.name in ("miniconda3", "Anaconda3"):
        return "base"
    return "system"


def scan_environments() -> list[PythonEnv]:
    """扫描所有可用的 Python 环境并检测依赖状态。"""
    found_pythons: list[str] = []
    conda_set: set[str] = set()

    # 1. conda 环境
    for p in _find_conda_envs():
        if p not in found_pythons:
            found_pythons.append(p)
            conda_set.add(p)

    # 2. 系统 Python
    for p in _find_system_pythons():
        if p not in found_pythons:
            found_pythons.append(p)

    # 3. .env 中已配置的 PYTHON_PATH
    from .config import PROJECT_ROOT
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("PYTHON_PATH="):
                configured = line.split("=", 1)[1].strip().strip("\"'")
                if configured and configured not in found_pythons and Path(configured).exists():
                    found_pythons.insert(0, configured)

    # 4. 当前运行的 Python
    current = sys.executable
    if current and current not in found_pythons:
        found_pythons.append(current)

    # 检测每个环境
    all_deps: dict[str, str] = {}
    for deps in SERVICE_DEPS.values():
        all_deps.update(deps)

    results: list[PythonEnv] = []
    for python_path in found_pythons:
        version = _get_python_version(python_path)
        if not version:
            continue

        # 检查 Python 版本 >= 3.10
        try:
            parts = version.split(".")
            major, minor = int(parts[0]), int(parts[1])
            if major < 3 or (major == 3 and minor < 10):
                continue
        except (ValueError, IndexError):
            continue

        packages, missing = _check_packages(python_path, all_deps)
        has_cuda = _check_cuda(python_path)

        env = PythonEnv(
            path=python_path,
            version=version,
            is_conda=python_path in conda_set,
            env_name=_get_env_name(python_path),
            packages=packages,
            missing=missing,
            has_cuda=has_cuda,
        )
        env.score = _compute_score(env)
        results.append(env)

    # 按评分降序
    results.sort(key=lambda e: e.score, reverse=True)
    return results


def get_recommended_env() -> PythonEnv | None:
    """返回推荐环境（评分最高的）。"""
    envs = scan_environments()
    return envs[0] if envs else None


def env_to_dict(env: PythonEnv) -> dict:
    """将 PythonEnv 转为可 JSON 序列化的 dict。"""
    return asdict(env)


def get_all_deps_flat() -> dict[str, str]:
    """返回所有服务依赖的合并集合。"""
    all_deps: dict[str, str] = {}
    for deps in SERVICE_DEPS.values():
        all_deps.update(deps)
    return all_deps


def install_packages(python_path: str, packages: list[str]) -> subprocess.Popen:
    """在目标环境中安装缺失的包，返回 Popen 对象以便流式读取输出。"""
    cmd = [python_path, "-m", "pip", "install", "--progress-bar", "off", *packages]
    return subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000) if sys.platform == "win32" else 0,
    )
