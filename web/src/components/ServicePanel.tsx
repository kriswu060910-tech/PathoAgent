import { useState } from 'react'
import { useServices } from '../hooks/useServices'

export function ServicePanel() {
  const { services, loading, connected, toggle, fetchLogs } = useServices()
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
        title={connected ? '服务管理' : '后端服务未连接'}
      >
        <span className="service-dots">
          {names.map((name) => {
            const s = services[name]
            const color = !connected
              ? '#6b7280'
              : s.healthy ? '#4ade80' : s.crashed ? '#ef4444' : s.running ? '#fbbf24' : '#ef4444'
            return (
              <span
                key={name}
                className="service-dot-indicator"
                style={{ backgroundColor: color }}
              />
            )
          })}
        </span>
        <span className="service-label">
          {connected ? `${runningCount}/${total}` : '未连接'}
        </span>
      </button>

      {open && (
        <div className="service-dropdown">
          <div className="service-dropdown-header">
            <span>后端服务管理</span>
            <button className="service-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>

          {!connected && (
            <div className="service-disconnected-hint">
              <span className="service-warning-icon">⚠</span>
              <div>
                <p className="service-warning-title">Launcher 未连接</p>
                <p className="service-warning-desc">
                  无法获取后端服务状态。请确保 Launcher 已启动，或在设置中检查后端服务地址配置。
                  病理分析和细胞分割工具需要后端服务运行才能使用。
                </p>
              </div>
            </div>
          )}

          {names.map((name) => {
            const s = services[name]
            const statusColor = !connected
              ? '#6b7280'
              : s.healthy ? '#4ade80' : s.crashed ? '#ef4444' : s.running ? '#fbbf24' : '#ef4444'
            const statusText = !connected
              ? '未连接'
              : s.crashed
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
                  <span className="service-status-text" data-color={statusColor}>
                    {statusText}
                  </span>
                </div>
                <div className="service-actions">
                  <button
                    className="service-action-btn log"
                    onClick={() => showLogs(name)}
                    disabled={!connected}
                    title="查看日志"
                  >
                    日志
                  </button>
                  <button
                    className={`service-action-btn ${s.running ? 'stop' : 'start'}`}
                    disabled={loading === name || !connected}
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
                <div className="service-actions">
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
