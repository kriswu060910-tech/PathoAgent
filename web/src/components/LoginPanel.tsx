import { useState } from 'react'
import { login, register } from '../stores/auth'
import sealIcon from '../assets/seal.png'

export function LoginPanel() {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 客户端输入验证
    const trimmedUser = username.trim()
    if (!trimmedUser) {
      setError('用户名不能为空')
      return
    }
    if (trimmedUser.length < 2) {
      setError('用户名至少 2 个字符')
      return
    }
    if (!password || password.length < 4) {
      setError('密码至少 4 个字符')
      return
    }

    setIsSubmitting(true)
    try {
      const result = isRegister
        ? await register(trimmedUser, password, displayName)
        : await login(trimmedUser, password)

      if (!result.ok) {
        setError(result.error || '操作失败')
      }
    } catch {
      setError('操作失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const switchMode = () => {
    setIsRegister(!isRegister)
    setError('')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src={sealIcon} alt="Cookie" className="login-logo" />
          <h1>Cookie Agent</h1>
          <p className="login-subtitle">病理图像分析 AI Agent</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <h2>{isRegister ? '创建账户' : '登录'}</h2>

          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label>用户名</label>
            <input
              type="text"
              value={username}
              placeholder="输入用户名"
              autoFocus
              disabled={isSubmitting}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {isRegister && (
            <div className="login-field">
              <label>显示名称</label>
              <input
                type="text"
                value={displayName}
                placeholder="可选，默认使用用户名"
                disabled={isSubmitting}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}

          <div className="login-field">
            <label>密码</label>
            <input
              type="password"
              value={password}
              placeholder={isRegister ? '至少 4 位' : '输入密码'}
              disabled={isSubmitting}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="login-submit" disabled={isSubmitting}>
            {isSubmitting ? '处理中...' : (isRegister ? '注册' : '登录')}
          </button>

          <div className="login-switch">
            {isRegister ? '已有账户？' : '没有账户？'}
            <button
              type="button"
              className="login-switch-btn"
              disabled={isSubmitting}
              onClick={switchMode}
            >
              {isRegister ? '去登录' : '注册'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
