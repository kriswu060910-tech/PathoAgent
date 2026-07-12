import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices, getLauncherUrl, type PythonEnvInfo } from '../hooks/useServices'
import { getSettings } from '../stores/settings'
import { startLauncher, diagnoseLauncher, type LauncherDiagnosis } from '../utils/tauri'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface LauncherPollResult {
  ok: boolean
  aborted: boolean
}

function useLauncherStatusPoll() {
  const controllerRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const poll = useCallback(async (onConnected: () => void | Promise<void>): Promise<LauncherPollResult> => {
    cancel()
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      for (let i = 0; i < 30; i++) {
        try {
          await sleep(1000, controller.signal)
        } catch {
          return { ok: false, aborted: true }
        }
        try {
          const res = await fetch(`${getLauncherUrl()}/status`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
          })
          if (res.ok) {
            await onConnected()
            return { ok: true, aborted: false }
          }
        } catch { /* 还没就绪，继续等 */ }
      }
      return { ok: false, aborted: false }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [cancel])

  useEffect(() => () => cancel(), [cancel])

  return { poll, cancel }
}

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
  const { services, loading, connected, toggle, refresh, fetchLogs, setupInfo, fetchSetup, selectEnv, installDeps } = useServices()
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
  const [envSectionOpen, setEnvSectionOpen] = useState(false)
  const [envScanning, setEnvScanning] = useState(false)
  const [envInstalling, setEnvInstalling] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const autoStartAttempted = useRef(false)
  const wasConnectedRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const { poll: pollLauncher, cancel: cancelLauncherPoll } = useLauncherStatusPoll()
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
      cancelLauncherPoll()
    }
  }, [cancelLauncherPoll])

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
    setStartingLauncher(true)
    setDiagnosis(null)
    try {
      showToast('正在启动 Launcher...', 'info')
      const result = await startLauncher()
      if (result.ok) {
        showToast(result.message, 'success')
        const { ok, aborted } = await pollLauncher(async () => {
          await refresh()
          showToast('Launcher 已连接', 'success')
        })
        if (aborted) return
        if (!ok) {
          showToast('Launcher 启动超时，点击"诊断"查看详情', 'error')
          handleDiagnose()
        }
      } else {
        showToast(`启动失败: ${result.message}`, 'error')
        handleDiagnose()
      }
    } finally {
      setStartingLauncher(false)
    }
  }

  // 跟踪连接状态变化
  useEffect(() => {
    if (connected) {
      wasConnectedRef.current = true
    }
  }, [connected])

  // 应用启动时自动拉起 Launcher（最多重试 3 次）
  useEffect(() => {
    if (connected || autoStartAttempted.current || !total) return
    autoStartAttempted.current = true

    const autoStart = async () => {
      setStartingLauncher(true)
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const result = await startLauncher()
          if (result.ok) {
            const { ok, aborted } = await pollLauncher(async () => {
              await refresh()
              showToast('Launcher 已自动启动', 'success')
            })
            if (ok || aborted) return
          }
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 3000))
          }
        }
        showToast('Launcher 自动启动失败，请手动启动', 'error')
      } catch (err) {
        showToast(`Launcher 自动启动失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        setStartingLauncher(false)
      }
    }

    const timer = setTimeout(autoStart, 1500)
    return () => clearTimeout(timer)
  }, [connected, total, pollLauncher, refresh, showToast])

  // 断线自动重连：之前已连接 → 现在断开 → 等待 8 秒确认非临时波动 → 自动重启
  useEffect(() => {
    if (!connected && wasConnectedRef.current) {
      reconnectTimerRef.current = setTimeout(async () => {
        if (wasConnectedRef.current) {
          wasConnectedRef.current = false
          setStartingLauncher(true)
          try {
            const result = await startLauncher()
            if (result.ok) {
              await pollLauncher(async () => {
                await refresh()
                showToast('Launcher 已自动重连', 'success')
              })
            }
          } catch { /* ignore */ } finally {
            setStartingLauncher(false)
          }
        }
      }, 8000)
    } else {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }
  }, [connected, pollLauncher, refresh, showToast])

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

          {/* Python 环境区域 */}
          {connected && (
            <div className="service-env-section">
              <button
                className="service-env-header"
                onClick={() => {
                  setEnvSectionOpen(!envSectionOpen)
                  if (!envSectionOpen && !setupInfo) {
                    setEnvScanning(true)
                    fetchSetup().finally(() => setEnvScanning(false))
                  }
                }}
              >
                <span>🐍 Python 环境</span>
                <span className="service-env-toggle">{envSectionOpen ? '▾' : '▸'}</span>
              </button>
              {envSectionOpen && (
                <div className="service-env-body">
                  {envScanning ? (
                    <div className="service-env-scanning">扫描中...</div>
                  ) : setupInfo ? (
                    <>
                      <div className="service-env-current">
                        当前: <code>{setupInfo.current_python}</code>
                      </div>
                      {setupInfo.environments.map((env: PythonEnvInfo) => (
                        <div key={env.path} className="service-env-row">
                          <div className="service-env-row-info">
                            <span className={`service-env-dot ${env.missing.length === 0 ? 'ok' : 'warn'}`} />
                            <span className="service-env-name">
                              {env.is_conda && <span className="service-env-conda">conda</span>}
                              {env.env_name}
                            </span>
                            <span className="service-env-ver">py{env.version}</span>
                            {env.has_cuda && <span className="service-env-cuda">CUDA</span>}
                          </div>
                          <div className="service-env-row-actions">
                            {env.missing.length > 0 ? (
                              <button
                                className="service-action-btn install"
                                disabled={envInstalling === env.path}
                                onClick={async () => {
                                  setEnvInstalling(env.path)
                                  const result = await installDeps(env.path, env.missing)
                                  setEnvInstalling(null)
                                  showToast(result.ok ? '依赖安装完成' : `安装失败: ${result.output}`, result.ok ? 'success' : 'error')
                                }}
                              >
                                {envInstalling === env.path ? '安装中...' : `安装 ${env.missing.length} 缺失`}
                              </button>
                            ) : (
                              <span className="service-env-ok">✓ 依赖完整</span>
                            )}
                            {env.path !== setupInfo.current_python && (
                              <button
                                className="service-action-btn select"
                                onClick={async () => {
                                  const result = await selectEnv(env.path)
                                  showToast(result.message, result.ok ? 'success' : 'error')
                                  if (result.ok) fetchSetup()
                                }}
                              >
                                切换
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <button
                        className="service-action-btn rescan"
                        onClick={() => { setEnvScanning(true); fetchSetup().finally(() => setEnvScanning(false)) }}
                      >
                        🔄 重新扫描
                      </button>
                    </>
                  ) : (
                    <div className="service-env-error">无法获取环境信息</div>
                  )}
                </div>
              )}
            </div>
          )}

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
