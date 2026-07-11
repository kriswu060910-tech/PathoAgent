import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import { SplashScreen } from './components/SplashScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { AdminPanel } from './components/AdminPanel'
import { LoginPanel } from './components/LoginPanel'
import { SetupWizard } from './components/SetupWizard'
import { useChat } from './hooks/useChat'
import { useAuth } from './hooks/useAuth'
import { detectEnvironments } from './utils/tauri'
import './App.css'

const SETUP_DONE_KEY = 'cookie-agent-setup-done'

/** 已认证用户的主界面，useChat 仅在此组件内执行 */
function AuthenticatedApp() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
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
        onOpenAdmin={() => setAdminOpen(true)}
      />
      <main className="chat-container">
        <ChatHeader
          title={activeConversation.title}
          isLoading={isLoading}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <MessageList messages={activeConversation.messages} onOpenSettings={() => setSettingsOpen(true)} />
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </main>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
    </>
  )
}

function App() {
  const { loggedIn, user } = useAuth()
  const [showSetup, setShowSetup] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)

  useEffect(() => {
    if (!loggedIn || setupChecked) return
    setSetupChecked(true)

    // 如果已经完成过 setup，不再弹出
    if (localStorage.getItem(SETUP_DONE_KEY)) return

    // 检查 launcher 是否已配置好 Python 环境
    detectEnvironments().then((info) => {
      if (!info) return
      const current = info.environments.find((e) => e.path === info.current_python)
      if (current && current.missing.length > 0) {
        setShowSetup(true)
      } else if (info.environments.length === 0) {
        setShowSetup(true)
      }
    }).catch(() => { /* launcher 未就绪，跳过 */ })
  }, [loggedIn, setupChecked])

  if (!loggedIn) {
    return (
      <>
        <SplashScreen />
        <LoginPanel />
      </>
    )
  }

  if (showSetup) {
    return (
      <>
        <SplashScreen />
        <SetupWizard
          onComplete={() => {
            localStorage.setItem(SETUP_DONE_KEY, '1')
            setShowSetup(false)
          }}
          onSkip={() => {
            localStorage.setItem(SETUP_DONE_KEY, '1')
            setShowSetup(false)
          }}
        />
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
