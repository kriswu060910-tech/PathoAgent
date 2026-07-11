import React from 'react'
import type { Message } from '../types/agent'
import { formatTime } from '../utils'
import { BoundingBoxOverlay } from './BoundingBoxOverlay'
import sealIcon from '../assets/seal.png'
import ReactMarkdown from 'react-markdown'

interface MessageItemProps {
  message: Message
}

export const MessageItem = React.memo(function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'
  const hasAnnotations = !isUser && message.annotations && message.annotations.length > 0

  return (
    <div className={`message ${isUser ? 'user' : 'agent'}`}>
      <div className="message-avatar" aria-hidden="true">
        {isUser ? (
          '你'
        ) : (
          <img
            src={sealIcon}
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
              <div key={i} className={`image-wrapper ${hasAnnotations && i === 0 ? 'annotated' : ''}`}>
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="message-image"
                />
                {hasAnnotations && i === 0 && message.annotations && (
                  <BoundingBoxOverlay boxes={message.annotations} />
                )}
              </div>
            ))}
          </div>
        )}
        <div className="message-content">
          {isUser ? (
            message.content
          ) : (
            <ReactMarkdown urlTransform={(url) => /^https?:\/\//i.test(url) ? url : ''}>{message.content}</ReactMarkdown>
          )}
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
})
