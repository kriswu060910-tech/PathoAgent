import { useState } from 'react'
import { useSettings, type AppSettings } from '../hooks/useSettings'
import { agentService } from '../services/agent'
import type { AgentServiceImpl } from '../services/agent'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

type Section = 'llm' | 'vision' | 'search' | 'backend'

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { settings, update, reset } = useSettings()
  const [activeSection, setActiveSection] = useState<Section>('llm')
  const [saved, setSaved] = useState(false)

  if (!open) return null

  const handleSave = () => {
    (agentService as AgentServiceImpl).resetAllAgents()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    reset()
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
                  配置联网搜索。DuckDuckGo 免费无需 Key；Tavily 和 Serper 需要注册获取 API Key。
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
            {saved && <span className="settings-saved">已保存，Agent 将使用新配置</span>}
            <button className="settings-btn primary" onClick={handleSave}>保存并重建 Agent</button>
          </div>
        </div>
      </div>
    </div>
  )
}
