import { useState } from 'react'
import { useSettings, type AppSettings } from '../hooks/useSettings'
import { agentService } from '../services/agent'
import type { AgentServiceImpl } from '../services/agent'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

type Section = 'llm' | 'vision' | 'search' | 'backend'

interface ValidationResult {
  name: string
  ok: boolean
  message: string
}

async function validateSettings(s: AppSettings): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []

  // 验证 LLM API
  if (s.apiKey) {
    try {
      const baseURL = (s.baseURL || 'https://api.deepseek.com').replace(/\/$/, '')
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.apiKey}` },
        body: JSON.stringify({ model: s.model || 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
      })
      if (res.ok || res.status === 200) {
        results.push({ name: 'LLM API', ok: true, message: '连接成功' })
      } else if (res.status === 401 || res.status === 403) {
        results.push({ name: 'LLM API', ok: false, message: 'API Key 无效或已过期' })
      } else {
        results.push({ name: 'LLM API', ok: false, message: `请求失败 (${res.status})` })
      }
    } catch (err) {
      results.push({ name: 'LLM API', ok: false, message: `无法连接: ${err instanceof Error ? err.message : '网络错误'}` })
    }
  } else {
    results.push({ name: 'LLM API', ok: false, message: '未配置 API Key，Agent 将降级为简单聊天' })
  }

  // 验证视觉 API（仅当配置了时才验证）
  if (s.visionBaseUrl && s.visionApiKey) {
    try {
      const baseURL = s.visionBaseUrl.replace(/\/$/, '')
      const res = await fetch(`${baseURL}/models`, {
        headers: { 'Authorization': `Bearer ${s.visionApiKey}` },
      })
      if (res.ok) {
        results.push({ name: '视觉 API', ok: true, message: '连接成功' })
      } else if (res.status === 401 || res.status === 403) {
        results.push({ name: '视觉 API', ok: false, message: 'API Key 无效' })
      } else {
        // 有些 API 不支持 /models 端点，但能连上就算成功
        results.push({ name: '视觉 API', ok: true, message: `已连接 (HTTP ${res.status})` })
      }
    } catch (err) {
      results.push({ name: '视觉 API', ok: false, message: `无法连接: ${err instanceof Error ? err.message : '网络错误'}` })
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
      // 无论验证结果如何，都重建 Agent（用户可能知道某些服务未启动）
      ;(agentService as AgentServiceImpl).resetAllAgents()
    } catch {
      setResults([{ name: '验证', ok: false, message: '验证过程出错' }])
    } finally {
      setValidating(false)
    }
  }

  const handleReset = () => {
    reset()
    setResults(null)
    ;(agentService as AgentServiceImpl).resetAllAgents()
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
                {field('API Base URL', 'visionBaseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1')}
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
                  配置本地后端服务地址。病理分析和细胞分割工具需要对应的后端服务运行才能使用。
                </p>
                {field('病理分析后端', 'pathoApiUrl', 'http://localhost:8001')}
                {field('Cellpose 后端', 'cellposeApiUrl', 'http://localhost:8002')}
                {field('Launcher 管理器', 'launcherApiUrl', 'http://localhost:8099')}
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
