import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import { SplashScreen } from './components/SplashScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { useChat } from './hooks/useChat'
import './App.css'

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
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
    <>
      <SplashScreen />
      <div className="app">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={switchConversation}
          onCreate={createNewConversation}
          onDelete={deleteConversation}
          onOpenSettings={() => setSettingsOpen(true)}
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
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

export default App
