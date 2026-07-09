import { useCallback, useState } from 'react'
import type { Conversation, Message } from '../types/agent'
import { agentService } from '../services/agent'
import { generateId } from '../utils'

function createConversation(title = '新对话'): Conversation {
  const now = Date.now()
  return { id: generateId(), title, messages: [], createdAt: now, updatedAt: now }
}

function makeTitle(content: string): string {
  const clean = content.replace(/\n/g, ' ').trim()
  return clean.length > 20 ? `${clean.slice(0, 18)}…` : clean || '新对话'
}

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([
    createConversation('欢迎使用 Cookie'),
  ])
  const [activeId, setActiveId] = useState(conversations[0].id)
  const [isLoading, setIsLoading] = useState(false)

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? conversations[0]

  const switchConversation = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const createNewConversation = useCallback(() => {
    const conversation = createConversation()
    setConversations((prev) => [conversation, ...prev])
    setActiveId(conversation.id)
    return conversation.id
  }, [])

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id)
        if (id === activeId) {
          const first = next[0]
          if (first) {
            setActiveId(first.id)
          } else {
            const created = createConversation()
            next.unshift(created)
            setActiveId(created.id)
          }
        }
        return next
      })
    },
    [activeId],
  )

  /** 更新活动对话中指定消息的字段 */
  const patchMessage = useCallback(
    (messageId: string, patch: Partial<Message>) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c
          return {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, ...patch } : m,
            ),
          }
        }),
      )
    },
    [activeId],
  )

  /** 追加文本到指定消息 */
  const appendToMessage = useCallback(
    (messageId: string, chunk: string) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c
          return {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) =>
              m.id === messageId
                ? { ...m, content: m.content + chunk, status: 'streaming' as const }
                : m,
            ),
          }
        }),
      )
    },
    [activeId],
  )

  const sendMessage = useCallback(
    async (content: string, enableSearch?: boolean, images?: Message['images']) => {
      if ((!content.trim() && !images?.length) || isLoading) return

      const trimmed = content.trim()
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: trimmed,
        images,
        timestamp: Date.now(),
        status: 'done',
      }
      const agentMsgId = generateId()
      const agentMessage: Message = {
        id: agentMsgId,
        role: 'agent',
        content: '',
        timestamp: Date.now(),
        status: 'sending',
      }

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c
          return {
            ...c,
            title: c.title === '新对话' ? makeTitle(content) : c.title,
            messages: [...c.messages, userMessage, agentMessage],
            updatedAt: Date.now(),
          }
        }),
      )
      setIsLoading(true)

      try {
        const conversation =
          conversations.find((c) => c.id === activeId) ?? activeConversation
        const history = [...conversation.messages, userMessage]
        const request = { conversationId: activeId, messages: history, content: trimmed, enableSearch, images }

        if (agentService.streamMessage) {
          await agentService.streamMessage(request, (chunk) => {
            appendToMessage(agentMsgId, chunk)
          })
        } else {
          const response = await agentService.sendMessage(request)
          patchMessage(agentMsgId, { content: response.content })
        }

        patchMessage(agentMsgId, { status: 'done' })
      } catch (error) {
        const errorText = error instanceof Error ? error.message : '请求失败，请重试'
        patchMessage(agentMsgId, { content: errorText, status: 'error' })
      } finally {
        setIsLoading(false)
      }
    },
    [activeId, activeConversation, conversations, isLoading, appendToMessage, patchMessage],
  )

  return {
    conversations,
    activeId,
    activeConversation,
    isLoading,
    switchConversation,
    createNewConversation,
    deleteConversation,
    sendMessage,
  }
}
