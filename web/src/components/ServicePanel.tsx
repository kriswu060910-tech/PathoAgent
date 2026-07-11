import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../hooks/useServices'
import { getSettings } from '../stores/settings'
import { startLauncher, diagnoseLauncher, type LauncherDiagnosis } from '../utils/tauri'

function statusColor(connected: boolean, s: { healthy: boolean; crashed?: boolean; running: boolean }): string {
  if (!connected) return '#6b7280'
  if (s.healthy) return '#4ade80'
  if (s.crashed) return '#ef4444'
  return s.running ? '#fbbf24' : '#ef4444'
}

function statusText(connected: boolean, s: { healthy: boolean; crashed?: boolean; running: boolean; exit_code?: number | null }): string {
  if (!connected) return '未连接'
  if (s.crashed) return `崩溃 (code ${s.exit_code ?? '?'})`
  if (s.healthy) return '运行中'
  return s.running ? '启动中...' : '已停止'
}

interface ServicePanelProps {
  onOpenSettings?: () => void
}

export function ServicePanel({ onOpenSettings }: ServicePanelProps) {
  const { services, loading, connected, toggle, refresh, fetchLogs } = useServices()
  const [open, setOpen] = useState(false)
  const [logName, setLogName] = useState<string | null>(null)
  const [logContent, setLogContent] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'info' | 'success' | 'error'>('info')
  const [retrying, setRetrying] = useState(false)
  const [startingLauncher, setStartingLauncher] = useState(false)
  const [diagnosis, setDiagnosis] = useState<LauncherDiagnosis | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const launcherPollCancel = useRef(false)
  const autoStartAttempted = useRef(false)
  const names = Object.keys(services)

  const runningCount = names.filter((n) => services[n].running).length
  const total = names.length

  const showToast = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast(msg)
    setToastType(type)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      launcherPollCancel.current = true
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleRetry = async () => {
    setRetrying(true)
    await refresh()
    setRetrying(false)
  }

  const showLogs = async (name: string) => {
    if (!connected) {
      showToast('Launcher 未连接，无法获取日志')
      return
    }
    setLogName(name)
    setLogLoading(true)
    setLogContent(await fetchLogs(name))
    setLogLoading(false)
  }

  const handleToggle = (name: string, running: boolean) => {
    if (!connected) {
      showToast('Launcher 未连接，请先启动后端服务')
      return
    }
    toggle(name, running)
  }

  const handleOpenSettings = () => {
    setOpen(false)
    onOpenSettings?.()
  }

  const handleDiagnose = async () => {
    setDiagnosing(true)
    const result = await diagnoseLauncher()
    setDiagnosis(result)
    setDiagnosing(false)
  }

  const handleStartLauncher = async () => {
    launcherPollCancel.current = false
    setStartingLauncher(true)
    setDiagnosis(null)
    try {
      showToast('正在启动 Launcher...', 'info')
      const result = await startLauncher()
      if (result.ok) {
        showToast(result.message, 'success')
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          if (launcherPollCancel.current) return
          try {
            const res = await fetch(`${getSettings().launcherApiUrl || import.meta.env.VITE_LAUNCHER_API_URL || '/api/launcher'}/status`, { signal: AbortSignal.timeout(2000) })
            if (res.ok) {
              await refresh()
              showToast('Launcher 已连接', 'success')
              return
            }
          } catch { /* 还没就绪，继续等 */ }
        }
        if (!launcherPollCancel.current) {
          showToast('Launcher 启动超时，点击"诊断"查看详情', 'error')
          handleDiagnose()
        }
      } else {
        showToast(`启动失败: ${result.message}`, 'error')
        handleDiagnose()
      }
    } finally {
      if (!launcherPollCancel.current) {
        setStartingLauncher(false)
      }
    }
  }

  // 应用启动时自动拉起 Launcher
  useEffect(() => {
    if (connected || autoStartAttempted.current || !total) return
    autoStartAttempted.current = true

    const autoStart = async () => {
      setStartingLauncher(true)
      try {
        const result = await startLauncher()
        if (result.ok) {
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            try {
              const res = await fetch(`${getSettings().launcherApiUrl || import.meta.env.VITE_LAUNCHER_API_URL || '/api/launcher'}/status`, { signal: AbortSignal.timeout(2000) })
              if (res.ok) {
                await refresh()
                showToast('Launcher 已自动启动', 'success')
                return
              }
            } catch { /* 等待就绪 */ }
          }
          showToast('Launcher 自动启动超时，请手动启动', 'error')
        }
      } catch {
        // 静默失败，用户可手动启动
      } finally {
        setStartingLauncher(false)
      }
    }

    const timer = setTimeout(autoStart, 1500)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, total])

  if (!total) return null

  const launcherUrl = getSettings().launcherApiUrl

  return (
    <div className="service-panel-wrapper" ref={wrapperRef}>
      <button
        className="service-toggle-btn"
        onClick={() => setOpen(!open)}
        title={connected ? '服务管理' : '后端服务未连接'}
      >
        <span className="service-dots">
          {names.map((name) => (
            <span
              key={name}
              className="service-dot-indicator"
              style={{ backgroundColor: statusColor(connected, services[name]) }}
            />
          ))}
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
              <div className="service-disconnected-body">
                <p className="service-warning-title">Launcher 未连接</p>
                <p className="service-warning-desc">
                  无法连接到后端服务管理器。病理分析和细胞分割工具需要后端运行才能使用。
                </p>
                <div className="service-diag-info">
                  <span className="service-diag-label">当前地址</span>
                  <code className="service-diag-value">{launcherUrl || '(未配置)'}</code>
                </div>
                <div className="service-disconnected-actions">
                  <button
                    className="service-action-btn start-launcher"
                    onClick={handleStartLauncher}
                    disabled={startingLauncher}
                  >
                    {startingLauncher && <span className="service-spinner" />}
                    {startingLauncher ? '启动中...' : '🚀 启动 Launcher'}
                  </button>
                  <button
                    className="service-action-btn diagnose"
                    onClick={handleDiagnose}
                    disabled={diagnosing}
                  >
                    {diagnosing ? '诊断中...' : '🔍 诊断'}
                  </button>
                  <button
                    className="service-action-btn retry"
                    onClick={handleRetry}
                    disabled={retrying}
                  >
                    {retrying ? '重试中...' : '🔄 重新连接'}
                  </button>
                  <button
                    className="service-action-btn settings-link"
                    onClick={handleOpenSettings}
                  >
                    ⚙ 检查设置
                  </button>
                </div>

                {/* 诊断结果 */}
                {diagnosis && (
                  <details className="service-diag-details" open>
                    <summary>诊断结果</summary>
                    <div className="service-diag-content">
                      <DiagRow label="项目目录" ok={diagnosis.projectRoot.ok}
                        detail={diagnosis.projectRoot.ok ? (diagnosis.projectRoot.path || '') : (diagnosis.projectRoot.reason || '未找到')} />
                      <DiagRow label="Python 路径" ok={diagnosis.pythonPath.ok}
                        detail={diagnosis.pythonPath.ok ? (diagnosis.pythonPath.path || '') : (diagnosis.pythonPath.reason || '未找到')} />
                      <DiagRow label="Launcher 端口" ok={diagnosis.launcherRunning}
                        detail={`:${diagnosis.launcherPort} ${diagnosis.launcherRunning ? '(已运行)' : '(未响应)'}`} />
                      {diagnosis.wherePython.paths && diagnosis.wherePython.paths.length > 0 && (
                        <div className="service-diag-sub">
                          <span className="service-diag-label">where python</span>
                          {diagnosis.wherePython.paths.map((p, i) => (
                            <code key={i} className="service-diag-value">{p}</code>
                          ))}
                        </div>
                      )}
                      <div className="service-diag-sub">
                        <span className="service-diag-label">环境变量</span>
                        {Object.entries(diagnosis.envVars).map(([k, v]) => (
                          <div key={k}>
                            <code className="service-diag-key">{k}</code>
                            <code className="service-diag-value">{v || '(未设置)'}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                )}

                <details className="service-help-details">
                  <summary>如何启动后端？</summary>
                  <div className="service-help-content">
                    <p><strong>方式一：</strong>运行项目根目录的 <code>start.bat</code>，会自动启动 Launcher 和后端服务。</p>
                    <p><strong>方式二：</strong>手动启动 Launcher：</p>
                    <pre className="service-help-cmd">python -m launcher.main --auto-start</pre>
                    <p><strong>方式三：</strong>如果 Launcher 已在其他端口运行，点击"检查设置"修改地址。</p>
                    <p><strong>排错：</strong>点击"🔍 诊断"按钮查看路径解析详情。如果项目目录或 Python 未找到，请设置环境变量 <code>PATHO_AGENT_PROJECT</code> 和 <code>PYTHON_PATH</code>。</p>
                  </div>
                </details>
              </div>
            </div>
          )}

          {names.map((name) => {
            const s = services[name]
            const color = statusColor(connected, s)
            return (
              <div key={name} className="service-row">
                <div className="service-info">
                  <span
                    className="service-status-dot"
                    style={{ backgroundColor: color }}
                  />
                  <span className="service-name">{s.label}</span>
                  <span className="service-port">:{s.port}</span>
                  <span className="service-status-text" data-color={color}>
                    {statusText(connected, s)}
                  </span>
                </div>
                <div className="service-actions">
                  <button
                    className="service-action-btn log"
                    onClick={() => showLogs(name)}
                    title={connected ? '查看日志' : 'Launcher 未连接'}
                  >
                    日志
                  </button>
                  <button
                    className={`service-action-btn ${s.running ? 'stop' : 'start'}`}
                    disabled={loading === name || !connected}
                    onClick={() => handleToggle(name, s.running)}
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

      {toast && (
        <div className={`service-toast service-toast-${toastType}`}>{toast}</div>
      )}
    </div>
  )
}

function DiagRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="service-diag-row">
      <span className={`service-diag-indicator ${ok ? 'ok' : 'fail'}`}>{ok ? '✓' : '✗'}</span>
      <span className="service-diag-label">{label}</span>
      <code className="service-diag-value">{detail}</code>
    </div>
  )
}
