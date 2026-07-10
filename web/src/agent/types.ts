/**
 * Agent 核心类型定义。
 *
 * 一个最小 Agent 包含：
 * - Perception（感知）：接收外部输入
 * - Memory（记忆）：保存上下文
 * - Brain/LLM（认知）：推理与决策
 * - Tools（工具/行动）：执行动作并观察结果
 * - Action（输出）：向外界返回结果
 */

/** 单条 tool_call 记录 */
export interface ToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

/** 单条记忆（与前端 Message 解耦，便于扩展） */
export interface MemoryItem {
  id: string
  role: 'user' | 'agent' | 'system' | 'tool'
  content: string
  /** tool 调用结果会带上对应的 toolCallId */
  toolCallId?: string
  /** assistant 发起 tool_calls 时携带的元数据 */
  toolCalls?: ToolCall[]
  timestamp: number
}

/** 工具定义 */
export interface Tool {
  name: string
  description: string
  /** 参数说明：key 为参数名，value 为参数描述 */
  parameters: Record<string, string>
  execute(args: Record<string, string>): string | Promise<string>
}

/** 物体标注框 — 从前端类型层统一导入 */
export type { AnnotationBox } from '../types/agent'

/** Agent 运行事件，便于前端流式展示 */
export interface AgentEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'answer' | 'error'
  content: string
  payload?: Record<string, unknown>
}

/** 一次思考结果 */
export interface Thought {
  reasoning: string
  finalAnswer?: string
  action?: {
    tool: string
    args: Record<string, string>
  }
  /** 当模型决定调用工具时，需要把原始 tool_calls 回传给 Agent 写入记忆 */
  toolCalls?: ToolCall[]
}

/** LLM 抽象接口：由具体模型实现完整的感知-思考-行动循环 */
export interface LLM {
  think(context: MemoryItem[], tools?: Tool[]): Promise<Thought>
}

/** Agent 配置 */
export interface AgentConfig {
  /** 系统提示词 */
  systemPrompt?: string
  /** 最大迭代次数 */
  maxIterations?: number
  /** 是否展示思考过程 */
  showReasoning?: boolean
  /** LLM API 配置（来自 localStorage 设置） */
  apiConfig?: {
    apiKey?: string
    baseURL?: string
    model?: string
  }
  /** 视觉 API 配置 */
  visionConfig?: {
    baseURL?: string
    apiKey?: string
    model?: string
  }
  /** 搜索配置 */
  searchConfig?: {
    provider?: string
    apiKey?: string
  }
  /** 后端服务 URL 配置 */
  backendUrls?: {
    patho?: string
    cellpose?: string
    launcher?: string
  }
}
