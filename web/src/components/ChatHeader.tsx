import { ServicePanel } from './ServicePanel'

interface ChatHeaderProps {
  title: string
  isLoading: boolean
}

export function ChatHeader({ title, isLoading }: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <h1>{title}</h1>
      <div className="chat-header-actions">
        {isLoading && (
          <span className="loading-indicator">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
        )}
        <ServicePanel />
      </div>
    </header>
  )
}
