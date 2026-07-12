import { useCallback, useEffect, useState } from 'react'
import { detectEnvironments, selectPythonEnv, type PythonEnvInfo, type SetupInfo } from '../utils/tauri'
import { getLauncherUrl } from '../hooks/useServices'
import { getServiceKey } from '../agent/tools/shared'
import sealIcon from '../assets/seal.png'

interface SetupWizardProps {
  onComplete: () => void
  onSkip: () => void
}

type Step = 'scanning' | 'select' | 'install' | 'done'

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('scanning')
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [installing, setInstalling] = useState(false)
  const [installOutput, setInstallOutput] = useState('')
  const [installOk, setInstallOk] = useState(false)
  const [error, setError] = useState('')

  const scan = useCallback(async () => {
    setStep('scanning')
    setError('')
    const info = await detectEnvironments()
    if (info && info.environments.length > 0) {
      setSetupInfo(info)
      setSelectedIdx(0)
      setStep('select')
    } else {
      setError('未找到可用的 Python 环境。请安装 Python 3.10+ 和 conda/venv。')
    }
  }, [])

  useEffect(() => { scan() }, [scan])

  const selected = setupInfo?.environments[selectedIdx] ?? null

  const handleSelect = async () => {
    if (!selected) return
    const result = await selectPythonEnv(selected.path)
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (selected.missing.length > 0) {
      setStep('install')
    } else {
      setStep('done')
    }
  }

  const handleInstall = async () => {
    if (!selected) return
    setInstalling(true)
    setInstallOutput('')
    try {
      const res = await fetch(`${getLauncherUrl()}/setup/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getServiceKey()}` },
        body: JSON.stringify({ pythonPath: selected.path, packages: selected.missing }),
      })
      const data = await res.json() as { ok: boolean; output: string }
      setInstallOutput(data.output || '安装完成')
      setInstallOk(data.ok)
    } catch (err) {
      setInstallOutput(`安装失败: ${err instanceof Error ? err.message : String(err)}`)
      setInstallOk(false)
    } finally {
      setInstalling(false)
    }
  }

  const handleFinish = () => {
    onComplete()
  }

  return (
    <div className="login-page">
      <div className="setup-wizard">
        <div className="login-brand">
          <img src={sealIcon} alt="Cookie" className="login-logo" />
          <h1>环境配置向导</h1>
          <p className="login-subtitle">检测 Python 环境并配置后端依赖</p>
        </div>

        <div className="setup-steps">
          <span className={`setup-step ${step === 'scanning' ? 'active' : 'done'}`}>1. 扫描</span>
          <span className={`setup-step ${step === 'select' || step === 'install' ? 'active' : step === 'done' ? 'done' : ''}`}>2. 选择</span>
          <span className={`setup-step ${step === 'install' ? 'active' : step === 'done' ? 'done' : ''}`}>3. 依赖</span>
          <span className={`setup-step ${step === 'done' ? 'active' : ''}`}>4. 完成</span>
        </div>

        {error && <div className="login-error">{error}</div>}

        {/* Step 1: Scanning */}
        {step === 'scanning' && (
          <div className="setup-content">
            <div className="setup-scanning">
              <div className="setup-spinner" />
              <p>正在扫描系统中的 Python 环境...</p>
              <p className="setup-hint">检测 conda、venv、系统 Python 及依赖包</p>
            </div>
          </div>
        )}

        {/* Step 2: Select environment */}
        {step === 'select' && setupInfo && (
          <div className="setup-content">
            <p className="setup-desc">
              检测到 <strong>{setupInfo.environments.length}</strong> 个 Python 环境。
              推荐标记为 <span className="setup-recommended">推荐</span> 的环境。
            </p>
            <div className="setup-env-list">
              {setupInfo.environments.map((env, i) => (
                <EnvCard
                  key={env.path}
                  env={env}
                  selected={i === selectedIdx}
                  recommended={i === 0}
                  onSelect={() => setSelectedIdx(i)}
                />
              ))}
            </div>
            <div className="setup-current">
              当前使用: <code>{setupInfo.current_python}</code>
            </div>
            <div className="setup-actions">
              <button className="setup-btn secondary" onClick={onSkip}>跳过</button>
              <button className="setup-btn primary" onClick={handleSelect}>
                确认选择
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Install dependencies */}
        {step === 'install' && selected && (
          <div className="setup-content">
            <p className="setup-desc">
              选定环境 <strong>{selected.env_name}</strong> 缺少以下依赖：
            </p>
            <div className="setup-missing-list">
              {selected.missing.map((pkg) => (
                <span key={pkg} className="setup-missing-tag">{pkg}</span>
              ))}
            </div>
            <div className="setup-install-options">
              <button
                className="setup-btn primary"
                onClick={handleInstall}
                disabled={installing}
              >
                {installing ? '安装中...' : '🚀 自动安装'}
              </button>
              <details className="setup-manual-details">
                <summary>手动安装</summary>
                <div className="setup-manual-cmd">
                  <code>"{selected.path}" -m pip install {selected.missing.join(' ')}</code>
                </div>
              </details>
            </div>
            {installOutput && (
              <div className={`setup-install-output ${installOk ? 'success' : 'error'}`}>
                <pre>{installOutput}</pre>
                {installOk && (
                  <button className="setup-btn primary" onClick={() => setStep('done')}>
                    继续
                  </button>
                )}
              </div>
            )}
            <div className="setup-actions">
              <button className="setup-btn secondary" onClick={() => setStep('select')}>返回</button>
              <button className="setup-btn secondary" onClick={() => setStep('done')}>跳过安装</button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="setup-content">
            <div className="setup-done">
              <span className="setup-done-icon">✅</span>
              <h3>环境配置完成</h3>
              <p>Python 环境已保存，后端服务将使用此环境启动。</p>
              {selected && (
                <div className="setup-done-info">
                  <div>环境: <strong>{selected.env_name}</strong></div>
                  <div>路径: <code>{selected.path}</code></div>
                  <div>版本: Python {selected.version}</div>
                  {selected.has_cuda && <div>GPU: <span className="setup-cuda">CUDA 可用</span></div>}
                </div>
              )}
            </div>
            <div className="setup-actions">
              <button className="setup-btn primary" onClick={handleFinish}>
                进入应用
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EnvCard({ env, selected, recommended, onSelect }: {
  env: PythonEnvInfo
  selected: boolean
  recommended: boolean
  onSelect: () => void
}) {
  const totalDeps = Object.keys(env.packages).length
  const installedDeps = Object.values(env.packages).filter(Boolean).length
  const pct = totalDeps > 0 ? Math.round((installedDeps / totalDeps) * 100) : 0

  return (
    <div
      className={`setup-env-card ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="setup-env-header">
        <span className="setup-env-name">
          {env.is_conda && <span className="setup-conda-badge">conda</span>}
          {env.env_name}
          {recommended && <span className="setup-recommended-badge">推荐</span>}
        </span>
        <span className="setup-env-version">Python {env.version}</span>
      </div>
      <div className="setup-env-path"><code>{env.path}</code></div>
      <div className="setup-env-deps">
        <div className="setup-deps-bar">
          <div className="setup-deps-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="setup-deps-text">{installedDeps}/{totalDeps} 依赖</span>
        {env.has_cuda && <span className="setup-cuda-badge">CUDA</span>}
      </div>
    </div>
  )
}
