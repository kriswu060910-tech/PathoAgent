export interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  status?: 'sending' | 'streaming' | 'done' | 'error'
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface AgentRequest {
  conversationId: string
  messages: Message[]
  content: string
}

export interface AgentResponse {
  content: string
  done: boolean
}

export interface AgentService {
  sendMessage(request: AgentRequest): Promise<AgentResponse>
  streamMessage?(
    request: AgentRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void>
}
