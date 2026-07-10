import { ServicePanel } from './ServicePanel'

interface ChatHeaderProps {
  title: string
  isLoading: boolean
  onOpenSettings?: () => void
}

export function ChatHeader({ title, isLoading, onOpenSettings }: ChatHeaderProps) {
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
        <ServicePanel onOpenSettings={onOpenSettings} />
      </div>
    </header>
  )
}
