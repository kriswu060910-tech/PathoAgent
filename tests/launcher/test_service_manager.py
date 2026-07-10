"""Launcher ServiceManager 测试。"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from launcher.service_manager import ServiceManager, _ProcessHandle


def test_status_reports_unknown_service_as_not_running():
    manager = ServiceManager()
    with patch.object(manager, "_is_port_open", return_value=False):
        status = manager.status()
    assert "cellpose" in status
    assert "patho" in status
    for svc in status.values():
        assert svc["running"] is False
        assert svc["healthy"] is False
        assert svc["crashed"] is False


def test_start_unknown_service_raises_keyerror():
    manager = ServiceManager()
    with pytest.raises(KeyError):
        manager.start("unknown")


def test_stop_unknown_service_raises_keyerror():
    manager = ServiceManager()
    with pytest.raises(KeyError):
        manager.stop("unknown")


def test_read_logs_unknown_service_raises_keyerror():
    manager = ServiceManager()
    with pytest.raises(KeyError):
        manager.read_logs("unknown")


def test_read_logs_returns_empty_for_missing_log():
    manager = ServiceManager()
    # patch get() 返回一个 Service，其 log_path 指向不存在的文件
    with patch.object(manager, "get") as mock_get:
        mock_get.return_value.log_path = Path("/nonexistent/path/cellpose.log")
        result = manager.read_logs("cellpose")
    assert result["logs"] == ""
    assert "暂无日志" in result["message"]


def test_read_tail_small_file(tmp_path: Path):
    manager = ServiceManager()
    log = tmp_path / "test.log"
    log.write_text("line1\nline2\nline3\n", encoding="utf-8")
    tail = manager._read_tail(log, 2)
    assert tail == ["line2", "line3"]


def test_read_tail_more_lines_than_file(tmp_path: Path):
    manager = ServiceManager()
    log = tmp_path / "test.log"
    log.write_text("line1\nline2\n", encoding="utf-8")
    tail = manager._read_tail(log, 10)
    assert tail == ["line1", "line2"]


def test_start_skips_when_port_healthy(tmp_path: Path):
    manager = ServiceManager()
    with patch.object(manager, "_is_port_open", return_value=True):
        result = manager.start("cellpose", wait=True, timeout_seconds=1)
    assert "正在启动中" in result["message"] or "启动成功" in result["message"]


def test_shutdown_stops_running_process():
    manager = ServiceManager()
    mock_proc = MagicMock()
    mock_proc.poll.return_value = None
    mock_proc.wait.return_value = 0
    mock_file = MagicMock()
    manager._processes["cellpose"] = _ProcessHandle(mock_proc, mock_file)

    result = manager.stop("cellpose")
    assert "已停止" in result["message"]
    mock_proc.terminate.assert_called_once()
    mock_file.close.assert_called_once()
