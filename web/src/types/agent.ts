export interface MessageAttachment {
  /** base64 data URL: data:image/jpeg;base64,... */
  dataUrl: string
  name: string
  type: 'image'
}

export interface AnnotationBox {
  label: string
  x: number
  y: number
  width: number
  height: number
  confidence?: number
  /** 指定标注颜色（如 "#ef4444"），未设置时使用默认调色板 */
  color?: string
  /** 多边形顶点（归一化 0-1），用于沿物体边缘绘制 */
  points?: { x: number; y: number }[]
}

export interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  images?: MessageAttachment[]
  annotations?: AnnotationBox[]
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
  annotations?: AnnotationBox[]
}

export interface AgentService {
  sendMessage(request: AgentRequest): Promise<AgentResponse>
  streamMessage?(
    request: AgentRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void>
  getAnnotations?(conversationId: string): AnnotationBox[]
}
