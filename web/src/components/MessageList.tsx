import { useEffect, useRef } from 'react'
import type { Message } from '../types/agent'
import { MessageItem } from './MessageItem'
import { useSettings } from '../hooks/useSettings'

interface MessageListProps {
  messages: Message[]
  onOpenSettings?: () => void
}

export function MessageList({ messages, onOpenSettings }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { settings } = useSettings()
  const hasApiKey = !!settings.apiKey

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="welcome-hint">
          <h3>开始对话</h3>
          <p>在下方输入框发送消息，Cookie 会在此回复。</p>
          {!hasApiKey && (
            <div className="welcome-config-hint">
              <span className="welcome-config-icon">⚙</span>
              <div className="welcome-config-body">
                <p className="welcome-config-title">尚未配置 LLM API</p>
                <p className="welcome-config-desc">
                  配置 API Key 后 Agent 才能使用工具调用、病理分析等高级功能。未配置时仅支持简单聊天。
                </p>
                {onOpenSettings && (
                  <button className="welcome-config-btn" onClick={onOpenSettings}>
                    前往配置
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="message-list">
      {!hasApiKey && (
        <div className="chat-config-banner" onClick={onOpenSettings}>
          <span>⚠</span> 未配置 LLM API，工具调用不可用
          {onOpenSettings && <span className="chat-config-banner-link">前往配置 →</span>}
        </div>
      )}
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
