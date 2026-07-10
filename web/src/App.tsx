import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import { SplashScreen } from './components/SplashScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { LoginPanel } from './components/LoginPanel'
import { useChat } from './hooks/useChat'
import { useAuth } from './hooks/useAuth'
import './App.css'

/** 已认证用户的主界面，useChat 仅在此组件内执行 */
function AuthenticatedApp() {
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
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <MessageList messages={activeConversation.messages} />
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </main>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

function App() {
  const { loggedIn, user } = useAuth()

  if (!loggedIn) {
    return (
      <>
        <SplashScreen />
        <LoginPanel />
      </>
    )
  }

  return (
    <>
      <SplashScreen />
      <div className="app" key={user?.username}>
        <AuthenticatedApp />
      </div>
    </>
  )
}

export default App
