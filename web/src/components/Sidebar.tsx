import type { Conversation } from '../types/agent'
import { formatTime } from '../utils'
import { useAuth } from '../hooks/useAuth'
import { logout } from '../stores/auth'
import sealIcon from '../assets/seal.png'

interface SidebarProps {
  conversations: Conversation[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onOpenSettings,
}: SidebarProps) {
  const { user } = useAuth()
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src={sealIcon} alt="" className="sidebar-logo" />
          <h2>Cookie</h2>
        </div>
        <button type="button" className="new-chat-btn" onClick={onCreate}>
          + 新对话
        </button>
      </div>

      <nav className="conversation-list">
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            role="button"
            tabIndex={0}
            className={`conversation-item ${
              conversation.id === activeId ? 'active' : ''
            }`}
            onClick={() => onSelect(conversation.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(conversation.id) }}
          >
            <span className="conversation-title">{conversation.title}</span>
            <span className="conversation-meta">
              {formatTime(conversation.updatedAt)}
            </span>
            <button
              type="button"
              className="delete-btn"
              title="删除对话"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(conversation.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user-info">
          <span className="sidebar-user-avatar">{user?.displayName?.[0]?.toUpperCase() || '?'}</span>
          <span className="sidebar-user-name">{user?.displayName || user?.username}</span>
          <button type="button" className="sidebar-logout-btn" onClick={() => logout()} title="退出登录">
            ⎋
          </button>
        </div>
        <button type="button" className="settings-trigger-btn" onClick={onOpenSettings}>
          ⚙ 设置
        </button>
      </div>
    </aside>
  )
}

