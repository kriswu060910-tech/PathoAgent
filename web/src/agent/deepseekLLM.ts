import type { MemoryItem, Thought, Tool, LLM } from './types'

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
}

/**
 * DeepSeekLLM：调用 DeepSeek API（chat.completions）进行推理。
 * 使用 function-calling / tools 让模型自主决定是否调用工具。
 */
export class DeepSeekLLM implements LLM {
  private apiKey: string
  private baseURL: string
  private model: string
  private tools: Tool[]

  constructor(tools: Tool[], config?: { apiKey?: string; baseURL?: string; model?: string }) {
    this.apiKey = config?.apiKey || import.meta.env.VITE_API_KEY || ''
    this.baseURL = (config?.baseURL || import.meta.env.VITE_API_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
    this.model = config?.model || import.meta.env.VITE_API_MODEL || 'deepseek-chat'
    this.tools = tools
  }

  async think(context: MemoryItem[]): Promise<Thought> {
    const messages = this.buildMessages(context)
    const response = await this.chat(messages, true)

    const choice = response.choices?.[0]
    if (!choice) {
      return { reasoning: 'API 返回为空', finalAnswer: '抱歉，服务暂时没有响应。' }
    }

    const toolCalls = choice.message?.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0]
      const args = safeParseArgs(call.function?.arguments)
      return {
        reasoning: `模型决定调用工具 ${call.function?.name}。`,
        action: { tool: call.function?.name || '', args },
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id || 'tool-call-1',
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '{}',
          },
        })),
      }
    }

    return {
      reasoning: '模型直接生成回答。',
      finalAnswer: choice.message?.content || '抱歉，我没有得到有效回复。',
    }
  }

  async answerWithObservation(
    context: MemoryItem[],
    _observation: string,
  ): Promise<string> {
    const messages = this.buildMessages(context)
    const response = await this.chat(messages, false)
    return response.choices?.[0]?.message?.content || '抱歉，整理结果时出错了。'
  }

  private buildMessages(context: MemoryItem[]): DeepSeekMessage[] {
    return context.map((item) => {
      if (item.role === 'tool') {
        return {
          role: 'tool',
          content: item.content,
          tool_call_id: item.toolCallId || 'tool-call-1',
        }
      }
      if (item.role === 'agent' && item.toolCalls && item.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: item.content || null,
          tool_calls: item.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: tc.function,
          })),
        } as DeepSeekMessage
      }
      return {
        role: item.role === 'agent' ? 'assistant' : item.role,
        content: item.content,
      } as DeepSeekMessage
    })
  }

  private async chat(messages: DeepSeekMessage[], includeTools: boolean): Promise<DeepSeekResponse> {
    const body: Record<string, unknown> = { model: this.model, messages }

    if (includeTools && this.tools.length > 0) {
      body.tools = this.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(tool.parameters).map(([key, description]) => [
                key,
                { type: 'string', description },
              ]),
            ),
            required: Object.keys(tool.parameters),
          },
        },
      }))
    }

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`DeepSeek API error ${res.status}: ${text}`)
    }

    return (await res.json()) as DeepSeekResponse
  }
}

function safeParseArgs(raw?: string): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)]),
    )
  } catch {
    return {}
  }
}
