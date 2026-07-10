import { useState } from 'react'
import { useSettings, type AppSettings } from '../hooks/useSettings'
import { sanitizeHeaders } from '../agent/tools/shared'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

type Section = 'llm' | 'vision' | 'search' | 'backend' | 'guide'

interface ValidationResult {
  name: string
  ok: boolean
  message: string
}

async function validateSettings(s: AppSettings): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []
  const VALIDATION_TIMEOUT = 10_000

  // 验证 LLM API
  if (s.apiKey) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT)
    try {
      const baseURL = (s.baseURL || 'https://api.deepseek.com').replace(/\/$/, '')
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: sanitizeHeaders({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.apiKey}` }),
        body: JSON.stringify({ model: s.model || 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
        signal: controller.signal,
      })
      if (res.ok || res.status === 200) {
        results.push({ name: 'LLM API', ok: true, message: '连接成功' })
      } else if (res.status === 401 || res.status === 403) {
        results.push({ name: 'LLM API', ok: false, message: 'API Key 无效或已过期' })
      } else {
        results.push({ name: 'LLM API', ok: false, message: `请求失败 (${res.status})` })
      }
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'AbortError'
        ? `连接超时 (${VALIDATION_TIMEOUT / 1000}s)`
        : `无法连接: ${err instanceof Error ? err.message : '网络错误'}`
      results.push({ name: 'LLM API', ok: false, message: msg })
    } finally {
      clearTimeout(timer)
    }
  } else {
    results.push({ name: 'LLM API', ok: false, message: '未配置 API Key，Agent 将降级为简单聊天' })
  }

  // 验证视觉 API（仅当配置了时才验证）
  if (s.visionBaseUrl && s.visionApiKey) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT)
    try {
      const baseURL = s.visionBaseUrl.replace(/\/$/, '')
      const res = await fetch(`${baseURL}/models`, {
        headers: sanitizeHeaders({ 'Authorization': `Bearer ${s.visionApiKey}` }),
        signal: controller.signal,
      })
      if (res.ok) {
        results.push({ name: '视觉 API', ok: true, message: '连接成功' })
      } else if (res.status === 401 || res.status === 403) {
        results.push({ name: '视觉 API', ok: false, message: 'API Key 无效' })
      } else {
        results.push({ name: '视觉 API', ok: true, message: `已连接 (HTTP ${res.status})` })
      }
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'AbortError'
        ? `连接超时 (${VALIDATION_TIMEOUT / 1000}s)`
        : `无法连接: ${err instanceof Error ? err.message : '网络错误'}`
      results.push({ name: '视觉 API', ok: false, message: msg })
    } finally {
      clearTimeout(timer)
    }
  }

  // 验证后端服务
  const backends = [
    { url: s.pathoApiUrl, name: '病理分析' },
    { url: s.cellposeApiUrl, name: 'Cellpose' },
  ]
  for (const backend of backends) {
    if (backend.url) {
      try {
        const res = await fetch(`${backend.url}/health`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          results.push({ name: backend.name, ok: true, message: '运行中' })
        } else {
          results.push({ name: backend.name, ok: false, message: `响应异常 (${res.status})` })
        }
      } catch {
        results.push({ name: backend.name, ok: false, message: '未运行或无法访问' })
      }
    }
  }

  return results
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { settings, update, reset } = useSettings()
  const [activeSection, setActiveSection] = useState<Section>('llm')
  const [validating, setValidating] = useState(false)
  const [results, setResults] = useState<ValidationResult[] | null>(null)

  if (!open) return null

  const handleSave = async () => {
    setValidating(true)
    setResults(null)
    try {
      const validationResults = await validateSettings(settings)
      setResults(validationResults)
    } catch {
      setResults([{ name: '验证', ok: false, message: '验证过程出错' }])
    } finally {
      setValidating(false)
    }
  }

  const handleReset = () => {
    reset()
    setResults(null)
  }

  const field = (
    label: string,
    key: keyof AppSettings,
    placeholder?: string,
    type: 'text' | 'password' = 'text',
    hint?: string,
  ) => (
    <div className="settings-field">
      <label>{label}</label>
      <input
        type={type}
        value={settings[key]}
        placeholder={placeholder}
        onChange={(e) => update({ [key]: e.target.value })}
      />
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  )

  const sections: { key: Section; label: string }[] = [
    { key: 'llm', label: 'LLM 模型' },
    { key: 'vision', label: '视觉识别' },
    { key: 'search', label: '联网搜索' },
    { key: 'backend', label: '后端服务' },
    { key: 'guide', label: '部署指南' },
  ]

  const successCount = results?.filter((r) => r.ok).length ?? 0
  const totalCount = results?.length ?? 0

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            {sections.map((s) => (
              <button
                key={s.key}
                className={`settings-nav-item ${activeSection === s.key ? 'active' : ''}`}
                onClick={() => setActiveSection(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {activeSection === 'llm' && (
              <div className="settings-section">
                <p className="settings-section-desc">
                  配置 LLM API 以启用 Agent 工具调用功能。不配置则只能进行简单聊天。
                </p>
                {field('API Key', 'apiKey', 'sk-...', 'password', '从 DeepSeek 平台获取')}
                {field('API Base URL', 'baseURL', 'https://api.deepseek.com')}
                {field('模型名称', 'model', 'deepseek-chat')}
              </div>
            )}

            {activeSection === 'vision' && (
              <div className="settings-section">
                <p className="settings-section-desc">
                  配置视觉 API 以启用 OCR 文字识别和物体标注功能。支持 OpenAI 兼容的多模态接口。
                </p>
                {field('API Base URL', 'visionBaseUrl', '/api/vision（开发环境默认代理）')}
                {field('API Key', 'visionApiKey', 'sk-...', 'password')}
                {field('模型名称', 'visionModel', 'qwen-vl-max')}
              </div>
            )}

            {activeSection === 'search' && (
              <div className="settings-section">
                <p className="settings-section-desc">
                  默认使用 DuckDuckGo 免费搜索（通过 CORS 代理）。如需更稳定可靠的搜索，建议注册 Tavily API Key（免费额度 1000 次/月）。
                </p>
                <div className="settings-field">
                  <label>搜索供应商</label>
                  <select
                    value={settings.searchProvider}
                    onChange={(e) => update({ searchProvider: e.target.value })}
                  >
                    <option value="duckduckgo">DuckDuckGo（免费）</option>
                    <option value="tavily">Tavily</option>
                    <option value="serper">Serper（Google）</option>
                    <option value="mock">Mock（演示）</option>
                  </select>
                </div>
                {field('搜索 API Key', 'searchApiKey', '可选，DuckDuckGo 无需填写', 'password')}
              </div>
            )}

            {activeSection === 'backend' && (
              <div className="settings-section">
                <p className="settings-section-desc">
                  配置本地后端服务地址。病理分析和细胞分割工具需要对应的后端服务运行才能使用。开发环境默认使用 Vite 代理路径。
                </p>
                {field('病理分析后端', 'pathoApiUrl', '/api/patho')}
                {field('Cellpose 后端', 'cellposeApiUrl', '/api/cellpose')}
                {field('Launcher 管理器', 'launcherApiUrl', '/api/launcher')}
                {field('认证服务', 'authApiUrl', '/api/auth')}
              </div>
            )}

            {activeSection === 'guide' && (
              <div className="settings-section settings-guide">
                <h3 className="guide-title">📖 部署指南</h3>

                <div className="guide-block">
                  <h4>🖥️ 环境要求</h4>
                  <ul>
                    <li>GPU：NVIDIA 显卡，显存 ≥ 6GB（推荐 8GB+）</li>
                    <li>Python：3.10+（推荐 Conda 环境）</li>
                    <li>依赖：<code>pip install fastapi uvicorn transformers accelerate</code></li>
                  </ul>
                </div>

                <div className="guide-block guide-service">
                  <h4>🔬 服务一：Patho-R1 病理分析后端 <span className="guide-port">:8001</span></h4>
                  <p className="guide-desc">基于 Qwen2.5-VL-3B 多模态模型，支持病理图像分析、区域聚焦、多图对比。</p>

                  <h5>下载模型</h5>
                  <pre className="guide-code">
{`# 使用 modelscope 下载（国内推荐）
pip install modelscope
modelscope download --model Qwen/Qwen2.5-VL-3B-Instruct \\
  --local_dir D:/hf_models/Qwen2.5-VL-3B-Instruct

# 或使用 huggingface
pip install huggingface_hub
huggingface-cli download Qwen/Qwen2.5-VL-3B-Instruct \\
  --local_dir D:/hf_models/Qwen2.5-VL-3B-Instruct`}
                  </pre>

                  <h5>启动命令</h5>
                  <pre className="guide-code">
{`cd D:\\agent
python Patho-R1/server.py --model qwen --port 8001

# 指定模型路径（如不在默认位置）
python Patho-R1/server.py --model qwen --model-path D:/hf_models/Qwen2.5-VL-3B-Instruct`}
                  </pre>

                  <h5>验证</h5>
                  <pre className="guide-code">curl http://localhost:8001/health</pre>
                </div>

                <div className="guide-block guide-service">
                  <h4>🧬 服务二：Cellpose 细胞分割后端 <span className="guide-port">:8002</span></h4>
                  <p className="guide-desc">基于 Cellpose 深度学习模型，支持细胞核/细胞质分割、轮廓提取。</p>

                  <h5>安装依赖</h5>
                  <pre className="guide-code">
{`# 在 conda patho 环境中安装
conda activate patho
pip install cellpose[gui]
pip install fastapi uvicorn python-multipart`}
                  </pre>

                  <h5>启动命令</h5>
                  <pre className="guide-code">
{`cd D:\\agent
python cellpose/server.py --model cyto3 --port 8002

# 可选模型：cyto3（细胞质）、nuclei（细胞核）、cyto2
python cellpose/server.py --model nuclei --port 8002`}
                  </pre>

                  <h5>验证</h5>
                  <pre className="guide-code">curl http://localhost:8002/health</pre>
                </div>

                <div className="guide-block">
                  <h4>🚀 一键启动（推荐）</h4>
                  <p>运行项目根目录的 <code>start.bat</code>，自动启动 Launcher 和所有后端服务：</p>
                  <pre className="guide-code">
{`# 方式一：双击 start.bat
# 方式二：命令行
cd D:\\agent
python -m launcher.main --auto-start`}
                  </pre>
                  <p>Launcher 会自动管理所有服务的启停、健康检查和日志记录。</p>
                </div>

                <div className="guide-block">
                  <h4>🏗️ 服务架构</h4>
                  <div className="guide-arch">
                    <div className="guide-arch-row">
                      <span className="guide-arch-box frontend">前端 (React)</span>
                      <span className="guide-arch-arrow">→</span>
                      <span className="guide-arch-box launcher">Launcher :8099</span>
                    </div>
                    <div className="guide-arch-row indent">
                      <span className="guide-arch-arrow">↕</span>
                    </div>
                    <div className="guide-arch-row">
                      <span className="guide-arch-box patho">Patho-R1 :8001</span>
                      <span className="guide-arch-box cellpose">Cellpose :8002</span>
                      <span className="guide-arch-box auth">Auth :8100</span>
                    </div>
                  </div>
                </div>

                <div className="guide-block">
                  <h4>❓ 常见问题</h4>
                  <details className="guide-faq">
                    <summary>显存不足 (CUDA Out of Memory)</summary>
                    <p>Qwen2.5-VL-3B 约需 5-6GB 显存。确保关闭其他 GPU 占用程序，或使用 <code>--dtype float16</code> 参数。</p>
                  </details>
                  <details className="guide-faq">
                    <summary>Cellpose 首次运行很慢</summary>
                    <p>Cellpose 首次使用某个模型时会自动下载权重文件（约 100MB），需要网络连接。后续启动会直接使用缓存。</p>
                  </details>
                  <details className="guide-faq">
                    <summary>模型路径找不到</summary>
                    <p>检查 <code>Patho-R1/server.py</code> 中的模型路径配置，确保与下载路径一致。可通过 <code>--model-path</code> 参数指定。</p>
                  </details>
                  <details className="guide-faq">
                    <summary>端口被占用</summary>
                    <p>使用 <code>netstat -ano | findstr :8001</code> 查找占用进程，或用 <code>--port</code> 参数换端口后在设置中更新地址。</p>
                  </details>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-btn reset" onClick={handleReset}>恢复默认</button>
          <div className="settings-footer-right">
            {results && (
              <div className="settings-validation-results">
                <span className={`settings-validation-summary ${successCount === totalCount ? 'success' : 'warning'}`}>
                  {successCount}/{totalCount} 通过
                </span>
                {results.map((r, i) => (
                  <span key={i} className={`settings-validation-item ${r.ok ? 'ok' : 'fail'}`}>
                    {r.ok ? '✓' : '✗'} {r.name}: {r.message}
                  </span>
                ))}
              </div>
            )}
            <button className="settings-btn primary" onClick={handleSave} disabled={validating}>
              {validating ? '验证中...' : '验证并保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
