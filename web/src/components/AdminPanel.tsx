import { useCallback, useEffect, useState } from 'react'
import {
  fetchUsers, deleteUser, updateUserRole, resetUserPassword,
  updateDisplayName, updateUserEnabled, fetchUserSettings,
  batchDeleteUsers, batchEnableUsers, batchDisableUsers,
  type UserInfo, type UserSettingsData,
} from '../stores/auth'

interface AdminPanelProps {
  open: boolean
  onClose: () => void
}

type ModalMode = null
  | { type: 'reset-password'; user: UserInfo }
  | { type: 'edit-name'; user: UserInfo }
  | { type: 'view-settings'; user: UserInfo; data: UserSettingsData | null; loading: boolean }

export function AdminPanel({ open, onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [modal, setModal] = useState<ModalMode>(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    const list = await fetchUsers()
    setUsers(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) loadUsers()
    if (!open) {
      setConfirmDeleteId(null)
      setSelected(new Set())
      setModal(null)
    }
  }, [open, loadUsers])

  useEffect(() => {
    if (!actionError && !actionSuccess) return
    const t = setTimeout(() => { setActionError(''); setActionSuccess('') }, 3000)
    return () => clearTimeout(t)
  }, [actionError, actionSuccess])

  const showToast = (msg: string, isError = false) => {
    if (isError) setActionError(msg)
    else setActionSuccess(msg)
  }

  const handleDelete = async (user: UserInfo) => {
    if (confirmDeleteId !== user.id) {
      setConfirmDeleteId(user.id)
      return
    }
    setConfirmDeleteId(null)
    const ok = await deleteUser(user.id)
    if (ok) {
      loadUsers()
      showToast(`已删除用户 "${user.displayName || user.username}"`)
    } else {
      showToast(`删除用户 "${user.displayName || user.username}" 失败`, true)
    }
  }

  const handleToggleRole = async (user: UserInfo) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    const ok = await updateUserRole(user.id, newRole)
    if (ok) {
      loadUsers()
      showToast(`已${newRole === 'admin' ? '提升' : '降级'} "${user.displayName || user.username}"`)
    } else {
      showToast(`修改角色失败`, true)
    }
  }

  const handleToggleEnabled = async (user: UserInfo) => {
    const newEnabled = !user.enabled
    const ok = await updateUserEnabled(user.id, newEnabled)
    if (ok) {
      loadUsers()
      showToast(`已${newEnabled ? '启用' : '禁用'} "${user.displayName || user.username}"`)
    } else {
      showToast(`操作失败`, true)
    }
  }

  const handleViewSettings = async (user: UserInfo) => {
    setModal({ type: 'view-settings', user, data: null, loading: true })
    const data = await fetchUserSettings(user.id)
    setModal({ type: 'view-settings', user, data, loading: false })
  }

  // --- 批量操作 ---
  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === users.length) setSelected(new Set())
    else setSelected(new Set(users.map(u => u.id)))
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    const result = await batchDeleteUsers([...selected])
    if (result.ok) {
      setSelected(new Set())
      loadUsers()
      showToast(`已删除 ${result.deleted} 个用户`)
    } else {
      showToast(result.error || '批量删除失败', true)
    }
  }

  const handleBatchEnable = async () => {
    if (selected.size === 0) return
    const ok = await batchEnableUsers([...selected])
    if (ok) {
      setSelected(new Set())
      loadUsers()
      showToast(`已启用 ${selected.size} 个用户`)
    } else {
      showToast('批量启用失败', true)
    }
  }

  const handleBatchDisable = async () => {
    if (selected.size === 0) return
    const result = await batchDisableUsers([...selected])
    if (result.ok) {
      setSelected(new Set())
      loadUsers()
      showToast(`已禁用 ${selected.size} 个用户`)
    } else {
      showToast(result.error || '批量禁用失败', true)
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
          {(actionError || actionSuccess) && (
            <div className={`admin-toast ${actionError ? 'error' : 'success'}`}>
              {actionError || actionSuccess}
            </div>
          )}

          {selected.size > 0 && (
            <div className="admin-batch-bar">
              <span>已选 {selected.size} 项</span>
              <div className="admin-batch-actions">
                <button className="admin-btn enable" onClick={handleBatchEnable}>批量启用</button>
                <button className="admin-btn disable" onClick={handleBatchDisable}>批量禁用</button>
                <button className="admin-btn delete" onClick={handleBatchDelete}>批量删除</button>
              </div>
              <button className="admin-btn" onClick={() => setSelected(new Set())}>取消选择</button>
            </div>
          )}

          {loading ? (
            <div className="admin-loading">加载中...</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="admin-th-check">
                    <input
                      type="checkbox"
                      checked={users.length > 0 && selected.size === users.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>用户名</th>
                  <th>显示名</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={!user.enabled ? 'admin-row-disabled' : ''}>
                    <td className="admin-td-check">
                      <input
                        type="checkbox"
                        checked={selected.has(user.id)}
                        onChange={() => toggleSelect(user.id)}
                      />
                    </td>
                    <td>{user.username}</td>
                    <td>{user.displayName || '-'}</td>
                    <td>
                      <span className={`admin-role-badge ${user.role}`}>
                        {user.role === 'admin' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-status-badge ${user.enabled ? 'enabled' : 'disabled'}`}>
                        {user.enabled ? '正常' : '已禁用'}
                      </span>
                    </td>
                    <td>{new Date(user.createdAt * 1000).toLocaleDateString()}</td>
                    <td className="admin-actions">
                      <button className="admin-btn role" onClick={() => handleToggleRole(user)}
                        title={user.role === 'admin' ? '降为普通用户' : '提升为管理员'}>
                        {user.role === 'admin' ? '降级' : '升级'}
                      </button>
                      <button className="admin-btn toggle" onClick={() => handleToggleEnabled(user)}
                        title={user.enabled ? '禁用此用户' : '启用此用户'}>
                        {user.enabled ? '禁用' : '启用'}
                      </button>
                      <button className="admin-btn edit" onClick={() => setModal({ type: 'edit-name', user })}
                        title="修改显示名">改名</button>
                      <button className="admin-btn password" onClick={() => setModal({ type: 'reset-password', user })}
                        title="重置密码">密码</button>
                      <button className="admin-btn view" onClick={() => handleViewSettings(user)}
                        title="查看用户设置">设置</button>
                      <button
                        onClick={() => handleDelete(user)}
                        title="删除用户"
                        className={`admin-btn delete${confirmDeleteId === user.id ? ' confirm' : ''}`}
                      >
                        {confirmDeleteId === user.id ? '确认?' : '删除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 模态框 */}
        {modal && <AdminModal modal={modal} onClose={() => setModal(null)} onDone={loadUsers} showToast={showToast} />}
      </div>
    </div>
  )
}

// --- 模态框组件 ---

function AdminModal({ modal, onClose, onDone, showToast }: {
  modal: ModalMode
  onClose: () => void
  onDone: () => void
  showToast: (msg: string, isError?: boolean) => void
}) {
  if (!modal) return null

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        {modal.type === 'reset-password' && (
          <ResetPasswordForm user={modal.user} onClose={onClose} onDone={onDone} showToast={showToast} />
        )}
        {modal.type === 'edit-name' && (
          <EditNameForm user={modal.user} onClose={onClose} onDone={onDone} showToast={showToast} />
        )}
        {modal.type === 'view-settings' && (
          <ViewSettings user={modal.user} data={modal.data} loading={modal.loading} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

function ResetPasswordForm({ user, onClose, onDone, showToast }: {
  user: UserInfo; onClose: () => void; onDone: () => void
  showToast: (msg: string, isError?: boolean) => void
}) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (pw.length < 8) { showToast('密码至少 8 个字符', true); return }
    if (pw !== confirm) { showToast('两次密码不一致', true); return }
    setSaving(true)
    const result = await resetUserPassword(user.id, pw)
    setSaving(false)
    if (result.ok) {
      showToast(`已重置 "${user.displayName || user.username}" 的密码`)
      onClose()
    } else {
      showToast(result.error || '重置失败', true)
    }
  }

  return (
    <>
      <div className="admin-modal-header">
        <h3>重置密码</h3>
        <button className="settings-close" onClick={onClose}>✕</button>
      </div>
      <div className="admin-modal-body">
        <p className="admin-modal-hint">为用户 <strong>{user.displayName || user.username}</strong> 设置新密码</p>
        <label>新密码
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="至少 8 个字符" />
        </label>
        <label>确认密码
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="再次输入" />
        </label>
      </div>
      <div className="admin-modal-footer">
        <button className="admin-btn" onClick={onClose}>取消</button>
        <button className="admin-btn save" onClick={handleSave} disabled={saving || !pw}>
          {saving ? '保存中...' : '确认重置'}
        </button>
      </div>
    </>
  )
}

function EditNameForm({ user, onClose, onDone, showToast }: {
  user: UserInfo; onClose: () => void; onDone: () => void
  showToast: (msg: string, isError?: boolean) => void
}) {
  const [name, setName] = useState(user.displayName || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { showToast('显示名不能为空', true); return }
    setSaving(true)
    const ok = await updateDisplayName(user.id, name.trim())
    setSaving(false)
    if (ok) {
      showToast(`已修改显示名`)
      onDone()
      onClose()
    } else {
      showToast('修改失败', true)
    }
  }

  return (
    <>
      <div className="admin-modal-header">
        <h3>修改显示名</h3>
        <button className="settings-close" onClick={onClose}>✕</button>
      </div>
      <div className="admin-modal-body">
        <p className="admin-modal-hint">用户 <strong>{user.username}</strong></p>
        <label>显示名
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="输入新的显示名" />
        </label>
      </div>
      <div className="admin-modal-footer">
        <button className="admin-btn" onClick={onClose}>取消</button>
        <button className="admin-btn save" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </>
  )
}

function ViewSettings({ user, data, loading, onClose }: {
  user: UserInfo; data: UserSettingsData | null; loading: boolean; onClose: () => void
}) {
  return (
    <>
      <div className="admin-modal-header">
        <h3>用户设置 — {user.displayName || user.username}</h3>
        <button className="settings-close" onClick={onClose}>✕</button>
      </div>
      <div className="admin-modal-body">
        {loading ? (
          <div className="admin-loading">加载中...</div>
        ) : data ? (
          <pre className="admin-settings-json">{JSON.stringify(data.settings, null, 2)}</pre>
        ) : (
          <p className="admin-modal-hint">无法获取该用户的设置数据</p>
        )}
      </div>
      <div className="admin-modal-footer">
        <button className="admin-btn" onClick={onClose}>关闭</button>
      </div>
    </>
  )
}
