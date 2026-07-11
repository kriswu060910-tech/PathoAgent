import { useCallback, useEffect, useState } from 'react'
import { fetchUsers, deleteUser, updateUserRole, type UserInfo } from '../stores/auth'

interface AdminPanelProps {
  open: boolean
  onClose: () => void
}

export function AdminPanel({ open, onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')

  const loadUsers = useCallback(async () => {
    setLoading(true)
    const list = await fetchUsers()
    setUsers(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) loadUsers()
  }, [open, loadUsers])

  const handleDelete = async (user: UserInfo) => {
    if (confirmDeleteId !== user.id) {
      setConfirmDeleteId(user.id)
      return
    }
    setConfirmDeleteId(null)
    const ok = await deleteUser(user.id)
    if (ok) {
      loadUsers()
    } else {
      setActionError(`删除用户 "${user.displayName || user.username}" 失败`)
    }
  }

  const handleToggleRole = async (user: UserInfo) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    const ok = await updateUserRole(user.id, newRole)
    if (ok) {
      loadUsers()
    } else {
      setActionError(`修改用户 "${user.displayName || user.username}" 角色失败`)
    }
  }

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel admin-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>🛡 用户管理</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="admin-content">
          {actionError && (
            <div className="admin-error">
              {actionError}
              <button onClick={() => setActionError('')}>✕</button>
            </div>
          )}
          {loading ? (
            <div className="admin-loading">加载中...</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>显示名</th>
                  <th>角色</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.displayName || '-'}</td>
                    <td>
                      <span className={`admin-role-badge ${user.role}`}>
                        {user.role === 'admin' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td>{new Date(user.createdAt * 1000).toLocaleDateString()}</td>
                    <td className="admin-actions">
                      <button
                        className="admin-btn role"
                        onClick={() => handleToggleRole(user)}
                        title={user.role === 'admin' ? '降为普通用户' : '提升为管理员'}
                      >
                        {user.role === 'admin' ? '降级' : '升级'}
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        title="删除用户"
                        className={`admin-btn delete${confirmDeleteId === user.id ? ' confirm' : ''}`}
                      >
                        {confirmDeleteId === user.id ? '确认删除?' : '删除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
