export interface MessageAttachment {
  /** base64 data URL: data:image/jpeg;base64,... */
  dataUrl: string
  name: string
  type: 'image'
}

export interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  images?: MessageAttachment[]
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
  /** 是否启用联网搜索工具 */
  enableSearch?: boolean
  /** 用户附带的图片 */
  images?: MessageAttachment[]
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
