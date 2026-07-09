import type { Message } from '../types/agent'
import { formatTime } from '../utils'

interface MessageItemProps {
  message: Message
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`message ${isUser ? 'user' : 'agent'}`}>
      <div className="message-avatar" aria-hidden="true">
        {isUser ? (
          '你'
        ) : (
          <img
            src="/avatar.jpg"
            alt="Cookie 头像"
            width="32"
            height="32"
          />
        )}
      </div>
      <div className="message-body">
        {message.images && message.images.length > 0 && (
          <div className="message-images">
            {message.images.map((img, i) => (
              <img
                key={i}
                src={img.dataUrl}
                alt={img.name}
                className="message-image"
              />
            ))}
          </div>
        )}
        <div className="message-content">
          {message.content || (message.status === 'sending' ? '' : '')}
          {message.status === 'streaming' && <span className="cursor" />}
        </div>
        <div className="message-meta">
          {formatTime(message.timestamp)}
          {message.status === 'error' && (
            <span className="error-label">发送失败</span>
          )}
        </div>
      </div>
    </div>
  )
}

