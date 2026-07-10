# Cookie - 病理图像分析 AI Agent

基于 ReAct 架构的病理图像分析 AI Agent，集成 DeepSeek LLM、Qwen2.5-VL 视觉模型和 Cellpose 细胞分割服务。

## 架构概览

```
┌─────────────────────────────────────────────────┐
│                  前端 (React + Vite)              │
│  ReAct Agent → 工具调用 → DeepSeek function calling │
└──────┬──────────┬──────────┬────────────────────┘
       │          │          │
  /api/patho  /api/cellpose  /api/launcher
       │          │          │
┌──────▼──┐ ┌────▼─────┐ ┌──▼────────┐
│Patho-R1 │ │ Cellpose │ │ Launcher  │
│ :8001   │ │ :8002    │ │ :8099     │
│(Qwen VL)│ │(cyto3)   │ │(服务管理) │
└─────────┘ └──────────┘ └───────────┘
```

## 环境要求

| 项目 | 要求 |
|------|------|
| GPU | NVIDIA GPU，显存 ≥ 8GB（推荐 RTX 4060 及以上） |
| Node.js | ≥ 18 |
| Python | 3.10+（推荐使用 Conda 管理） |
| Conda | Miniconda / Anaconda |

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/kriswu060910-tech/PathoAgent.git
cd PathoAgent
```

### 2. 配置环境变量（必须）

> **⚠️ 关键步骤：不配置 `VITE_API_KEY`，Agent 将降级为简单聊天模式，无法使用任何工具！**

```bash
cd web
cp .env.example .env
```

编辑 `.env`，**至少填写 `VITE_API_KEY`**：

```env
# 必须！DeepSeek API Key，从 https://platform.deepseek.com 获取
VITE_API_KEY=sk-your-actual-api-key-here
VITE_API_BASE_URL=https://api.deepseek.com
VITE_API_MODEL=deepseek-chat
```

其他可选配置（搜索、视觉识别、后端地址等）见 `.env.example` 中的注释说明。

### 3. 安装前端依赖

```bash
cd web
npm install
```

### 4. 安装 Python 后端依赖

```bash
# 创建 conda 环境
conda create -n patho python=3.10 -y
conda activate patho

# 安装后端依赖
pip install -r Patho-R1/requirements.txt
pip install -r cellpose/requirements.txt
pip install fastapi uvicorn
```

### 5. 准备模型文件

Patho-R1 后端需要本地部署 Qwen2.5-VL 模型。默认使用 `--model qwen` 加载 Qwen2.5-VL-3B-Instruct。

模型文件需提前下载到本地（可使用 HuggingFace 或 ModelScope），并在 `Patho-R1/server.py` 中配置模型路径。

### 6. 启动

**方式一：一键启动（推荐）**

```bash
# 在项目根目录
start.bat
```

这会自动启动 Launcher 服务管理器（端口 8099）和前端开发服务器（端口 5173），后端服务由 Launcher 自动拉起。

**方式二：手动启动**

```bash
# 终端 1：启动病理分析后端
conda activate patho
python Patho-R1/server.py --model qwen --port 8001

# 终端 2：启动细胞分割后端
conda activate patho
python cellpose/server.py --model cyto3 --port 8002

# 终端 3：启动服务管理器
conda activate patho
python launcher.py --auto-start

# 终端 4：启动前端
cd web
npm run dev
```

浏览器访问 `http://localhost:5173`。

## 工具集

| 工具 | 说明 | 依赖 |
|------|------|------|
| `calculator` | 数学计算 | 无 |
| `datetime` | 日期时间 | 无 |
| `web_search` | 联网搜索 | 搜索 API Key（可选） |
| `extract_text` | OCR 文字识别 | 视觉 API |
| `annotate_objects` | 边缘标注 | 视觉 API |
| `pathology_analyze` | 病理分析 + 区域聚焦 | Patho-R1 后端 |
| `pathology_compare` | 多图对比分析 | Patho-R1 后端 |
| `pathology_report` | 生成病理报告 | Patho-R1 后端 |
| `cell_segment` | 细胞分割计数 | Cellpose 后端 |
| `cell_measure` | 细胞形态测量 | Cellpose 后端 |

## 常见问题

### 克隆后只能简单聊天，工具无法使用

**原因：** `.env` 文件未被 Git 跟踪，克隆后缺少 API 密钥配置，Agent 降级为无工具调用的简单模式。

**解决：**
```bash
cd web
cp .env.example .env
# 编辑 .env，填写你的 DeepSeek API Key
```

### 后端服务启动失败

- 检查 Conda 环境 `patho` 是否已创建并安装了依赖
- 检查 GPU 显存是否足够（Qwen2.5-VL-3B 需要约 6-8GB）
- 查看 `logs/` 目录下的日志文件排查错误

### Python 路径不对

Launcher 默认使用 `D:\miniconda3\envs\patho\python.exe`。如果你的 Conda 安装路径不同，在 `.env` 或系统环境变量中设置：

```env
PYTHON_PATH=你的conda路径\envs\patho\python.exe
```
