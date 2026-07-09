import { Sidebar } from './components/Sidebar'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import { useChat } from './hooks/useChat'
import './App.css'

function App() {
  const {
    conversations,
    activeId,
    activeConversation,
    isLoading,
    switchConversation,
    createNewConversation,
    deleteConversation,
    sendMessage,
  } = useChat()

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={switchConversation}
        onCreate={createNewConversation}
        onDelete={deleteConversation}
      />
      <main className="chat-container">
        <ChatHeader
          title={activeConversation.title}
          isLoading={isLoading}
        />
        <MessageList messages={activeConversation.messages} />
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </main>
    </div>
  )
}

export default App
