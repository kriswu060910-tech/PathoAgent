interface ChatHeaderProps {
  title: string
  isLoading: boolean
}

export function ChatHeader({ title, isLoading }: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <h1>{title}</h1>
      {isLoading && (
        <span className="loading-indicator">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </span>
      )}
    </header>
  )
}
