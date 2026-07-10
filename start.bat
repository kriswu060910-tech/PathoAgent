@echo off
chcp 65001 >nul
title Cookie Agent Launcher

echo ============================================
echo   Cookie - 病理图像分析 AI Agent
echo ============================================
echo.

:: 启动服务管理器（端口 8099，自动拉起后端服务）
echo [1/2] 启动服务管理器 (port 8099)...
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
if defined PYTHON_PATH (set "PYTHON_EXE=%PYTHON_PATH%") else (set "PYTHON_EXE=D:\miniconda3\envs\patho\python.exe")
start "Agent Launcher" /min cmd /c "%PYTHON_EXE% -m launcher.main --auto-start"

:: 等待管理器就绪
timeout /t 3 /nobreak >nul

:: 启动前端开发服务器
echo [2/2] 启动前端开发服务器 (port 5173)...
echo.
echo 浏览器将自动打开，如未打开请访问 http://localhost:5173/
echo 后端服务正在后台加载，请在页面右上角查看启动进度。
echo.
start "" http://localhost:5173/
cd /d "%SCRIPT_DIR%web"
npm run dev
