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

### 2. 安装前端依赖

```bash
cd web
npm install
```

### 3. 配置 API（二选一）

#### 方式 A：通过应用内设置界面（推荐）

启动应用后，点击左侧边栏底部的 **「⚙ 设置」** 按钮，在弹出面板中填写：

- **LLM 模型**：API Key（必须）、Base URL、模型名称
- **视觉识别**：视觉 API 的 Base URL、Key、模型（用于 OCR 和物体标注）
- **联网搜索**：选择搜索供应商，按需填写 API Key
- **后端服务**：病理分析和 Cellpose 后端的地址

设置保存在浏览器本地（localStorage），下次打开自动加载。

#### 方式 B：通过 .env 文件

```bash
cd web
cp .env.example .env
```

编辑 `.env`，至少填写 `VITE_API_KEY`：

```env
# 必须！DeepSeek API Key，从 https://platform.deepseek.com 获取
VITE_API_KEY=sk-your-actual-api-key-here
VITE_API_BASE_URL=https://api.deepseek.com
VITE_API_MODEL=deepseek-chat
```

> **⚠️ 不配置 API Key，Agent 将降级为简单聊天模式，无法使用任何工具。**

### 4. 启动前端

```bash
cd web
npm run dev
```

浏览器访问 `http://localhost:5173`。此时基础工具（计算、时间、联网搜索）已可用。

如需使用病理分析和细胞分割工具，需继续部署后端服务（见下方）。

---

## 后端服务部署

病理分析（Patho-R1）和细胞分割（Cellpose）工具需要对应的 Python 后端服务运行。

### 1. 创建 Conda 环境

```bash
conda create -n patho python=3.10 -y
conda activate patho
```

### 2. 安装依赖

```bash
# 病理分析后端依赖
pip install -r Patho-R1/requirements.txt

# 细胞分割后端依赖
pip install -r cellpose/requirements.txt

# 通用依赖
pip install fastapi uvicorn
```

### 3. 下载模型文件

#### Patho-R1（Qwen2.5-VL-3B）

使用 HuggingFace 或 ModelScope 下载模型：

```bash
# 方式一：HuggingFace（需科学上网）
pip install huggingface_hub
huggingface-cli download Qwen/Qwen2.5-VL-3B-Instruct --local-dir D:/hf_models/Qwen2.5-VL-3B-Instruct

# 方式二：ModelScope（国内推荐）
pip install modelscope
modelscope download --model Qwen/Qwen2.5-VL-3B-Instruct --local_dir D:/hf_models/Qwen2.5-VL-3B-Instruct
```

下载完成后，可通过以下任一方式配置模型路径：

- **环境变量（推荐）**：设置 `PATHO_QWEN_MODEL_PATH=D:/hf_models/Qwen2.5-VL-3B-Instruct`
- **修改配置文件**：编辑 `Patho-R1/config.py` 中的 `MODEL_MAP["qwen"]`

#### Cellpose

Cellpose 的 `cyto3` 模型会在首次运行时自动下载，无需手动操作。

### 4. 启动后端服务

**方式一：一键启动（推荐）**

在项目根目录运行 `start.bat`，Launcher 会自动管理所有后端服务的启停。

**方式二：手动启动**

```bash
# 终端 1：病理分析后端（端口 8001）
conda activate patho
python Patho-R1/server.py --model qwen --port 8001

# 终端 2：细胞分割后端（端口 8002）
conda activate patho
python cellpose/server.py --model cyto3 --port 8002

# 终端 3：Launcher 服务管理器（端口 8099）
conda activate patho
python -m launcher.main --auto-start
```

### 5. 验证服务

启动后可通过以下方式验证：

```bash
# 检查病理分析后端
curl http://localhost:8001/health

# 检查细胞分割后端
curl http://localhost:8002/health

# 检查 Launcher（查看所有服务状态）
curl http://localhost:8099/status
```

也可以在应用顶栏的 **服务管理面板** 中查看服务状态（绿色圆点表示运行正常）。

### 6. Python 路径配置

Launcher 默认使用 `D:\miniconda3\envs\patho\python.exe`。如果 Conda 安装路径不同：

- **通过 .env 配置**：设置 `PYTHON_PATH=你的conda路径\envs\patho\python.exe`
- **通过系统环境变量**：添加 `PYTHON_PATH` 环境变量

### 7. 常用环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PYTHON_PATH` | Conda 环境中的 Python 解释器路径 | `D:\miniconda3\envs\patho\python.exe` |
| `PATHO_QWEN_MODEL_PATH` | Qwen2.5-VL-3B 模型本地路径 | `D:/hf_models/models/Qwen--Qwen2.5-VL-3B-Instruct/snapshots/master` |
| `PATHO_MAX_IMAGE_DIM` | 推理前图片最大边长 | `512` |
| `CELLPOSE_LOCAL_MODELS_PATH` | Cellpose 模型本地缓存目录 | `D:\cellpose\models` |
| `PATHO_PORT` / `CELLPOSE_PORT` / `LAUNCHER_PORT` | 各服务端口号 | `8001` / `8002` / `8099` |

也可以直接修改各服务目录下的 `config.py` 文件。

### 8. 日志与并发说明

- 后端服务（Launcher、Patho-R1、Cellpose）统一输出分级日志到 `logs/` 目录，并同时打印到控制台。
- 单个日志文件超过 10MB 会自动轮转，保留最近 5 个备份。
- Patho-R1 与 Cellpose 的模型推理已加互斥锁，同一时刻只处理一个推理请求，避免多请求并发导致 OOM 或输出异常。并发请求会串行排队。

### 9. 运行测试

```bash
# 安装开发依赖
pip install -r requirements-dev.txt

# 运行后端单元测试
pytest tests/
```

---

## 桌面应用部署（Tauri exe 安装包）

桌面安装包内已打包前端和全部 Python 后端代码，安装后打开即自动启动 Launcher 及所有后端服务。

### 前提条件

| 条件 | 说明 |
|------|------|
| Conda 环境 | 用户机器须已安装 Miniconda/Anaconda 并创建 `patho` 环境，装好所有后端依赖（见上方"后端服务部署"） |
| 模型文件 | Qwen2.5-VL-3B 模型须已下载到本地，并通过 `PATHO_QWEN_MODEL_PATH` 环境变量或 `.env` 配置路径 |
| NVIDIA 驱动 | GPU 显存 ≥ 8GB，已安装 CUDA 驱动 |
| 安装目录可写 | **不要**安装到 `C:\Program Files\`（默认路径），Launcher 运行时需要写入 `.env`、`logs/` 等文件，请自定义到 `D:\PathoAgent\` 等可写目录 |

> 安装包**不包含** Python 解释器、Conda 环境和模型权重文件——这些体积过大，需用户在目标机器上预先准备好。

### 自动启动机制

应用启动时，Tauri Rust 层按以下顺序定位项目资源和 Python：

1. **项目根目录**：优先检查 `exe所在目录/resources/`（NSIS 安装后 Python 后端代码在此），其次向上遍历 exe 父目录、当前工作目录、常见开发路径等
2. **Python 解释器**：优先查找 conda `patho` 环境（`D:\miniconda3\envs\patho\python.exe`），其次 base conda、`where python`、`conda run which python`
3. 两者都找到后，以 `DETACHED_PROCESS` 方式执行 `python -m launcher.main --auto-start`，轮询等待端口 8099 就绪（超时 10 秒），最多重试 2 次

### 安装后目录结构

```
D:\PathoAgent\                  ← 用户选择的安装目录
├── PathoAgent.exe              ← Tauri 桌面应用
└── resources\
    ├── launcher\               ← Launcher 服务管理器
    ├── auth\                   ← 用户认证服务
    ├── cellpose\               ← 细胞分割后端
    ├── Patho-R1\               ← 病理分析后端
    ├── shared\                 ← 共享模块
    ├── shared_image_utils.py
    ├── shared_logger.py
    └── .env                    ← 默认配置（首次运行后可写）
```

### 故障排查

如果桌面应用启动后后端服务未自动运行：

1. 查看 `<安装目录>\resources\launcher\logs\tauri-setup.log` 中的自动启动日志
2. 查看 `<安装目录>\resources\launcher\logs\launcher-stderr.log` 中的 Launcher 错误输出
3. 确认 `D:\miniconda3\envs\patho\python.exe` 存在（或设置 `PYTHON_PATH` 环境变量指向正确路径）
4. 确认安装目录可写（右键目录 → 属性 → 取消"只读"）

---

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

---

## 常见问题

### 只能简单聊天，工具无法使用

**原因：** 未配置 LLM API Key，Agent 降级为无工具调用的简单模式。

**解决：** 打开应用设置（侧边栏底部「⚙ 设置」），在「LLM 模型」页填写 API Key 并保存。

### 病理分析/细胞分割工具报错

**原因：** 对应的后端服务未启动。

**解决：**
1. 确保已按上述步骤部署后端服务
2. 运行 `start.bat` 一键启动，或手动启动对应服务
3. 在应用顶栏的服务管理面板查看服务状态

### 后端服务启动失败

- 检查 Conda 环境 `patho` 是否已创建并安装了依赖
- 检查 GPU 显存是否足够（Qwen2.5-VL-3B 需要约 6-8GB）
- 查看 `logs/` 目录下的 `launcher.log`、`patho.log`、`cellpose.log` 排查错误
- 确保模型文件已正确下载并配置路径
- 确保 `PYTHON_PATH` 指向的 Python 解释器存在

### 显存不足（OOM）

Qwen2.5-VL-3B float16 权重约 6GB，加上视觉编码器和 KV cache 后超过 8GB。如果出现 OOM：

- 考虑使用 4-bit 量化（bitsandbytes）将显存占用降至 ~2-3GB
- 关闭其他占用 GPU 的程序
