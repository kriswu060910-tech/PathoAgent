import { useState } from 'react'
import { useServices } from '../hooks/useServices'

export function ServicePanel() {
  const { services, loading, toggle, fetchLogs } = useServices()
  const [open, setOpen] = useState(false)
  const [logName, setLogName] = useState<string | null>(null)
  const [logContent, setLogContent] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const names = Object.keys(services)

  const runningCount = names.filter((n) => services[n].running).length
  const total = names.length

  const showLogs = async (name: string) => {
    setLogName(name)
    setLogLoading(true)
    setLogContent(await fetchLogs(name))
    setLogLoading(false)
  }

  if (!total) return null

  return (
    <div className="service-panel-wrapper">
      <button
        className="service-toggle-btn"
        onClick={() => setOpen(!open)}
        title="服务管理"
      >
        <span className="service-dots">
          {names.map((name) => {
            const s = services[name]
            const color = s.healthy ? '#4ade80' : s.crashed ? '#ef4444' : s.running ? '#fbbf24' : '#ef4444'
            return (
              <span
                key={name}
                className="service-dot-indicator"
                style={{ backgroundColor: color }}
              />
            )
          })}
        </span>
        <span className="service-label">{runningCount}/{total}</span>
      </button>

      {open && (
        <div className="service-dropdown">
          <div className="service-dropdown-header">
            <span>后端服务管理</span>
            <button className="service-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>
          {names.map((name) => {
            const s = services[name]
            const statusColor = s.healthy ? '#4ade80' : s.crashed ? '#ef4444' : s.running ? '#fbbf24' : '#ef4444'
            const statusText = s.crashed
              ? `崩溃 (code ${s.exit_code ?? '?'})`
              : s.healthy
                ? '运行中'
                : s.running
                  ? '启动中...'
                  : '已停止'
            return (
              <div key={name} className="service-row">
                <div className="service-info">
                  <span
                    className="service-status-dot"
                    style={{ backgroundColor: statusColor }}
                  />
                  <span className="service-name">{s.label}</span>
                  <span className="service-port">:{s.port}</span>
                  <span className="service-status-text" style={{ color: statusColor, fontSize: '12px', marginLeft: '6px' }}>
                    {statusText}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="service-action-btn log"
                    onClick={() => showLogs(name)}
                    title="查看日志"
                  >
                    日志
                  </button>
                  <button
                    className={`service-action-btn ${s.running ? 'stop' : 'start'}`}
                    disabled={loading === name}
                    onClick={() => toggle(name, s.running)}
                  >
                    {loading === name
                      ? (s.running ? '停止中...' : '加载中...')
                      : s.running ? '停止' : '启动'}
                  </button>
                </div>
              </div>
            )
          })}

          {logName && (
            <div className="service-log-viewer">
              <div className="service-log-header">
                <span>{services[logName]?.label} 日志</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button className="service-action-btn log" onClick={() => showLogs(logName)}>刷新</button>
                  <button className="service-close-btn" onClick={() => setLogName(null)}>✕</button>
                </div>
              </div>
              <pre className="service-log-content">
                {logLoading ? '加载中...' : logContent}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
