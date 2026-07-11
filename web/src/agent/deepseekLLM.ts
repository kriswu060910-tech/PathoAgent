import type { MemoryItem, Thought, Tool, LLM } from './types'
import { apiPost, parseArgs } from './tools/shared'

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

  async think(context: MemoryItem[], tools?: Tool[]): Promise<Thought> {
    const messages = this.buildMessages(context)
    const response = await this.chat(messages, true, tools)

    const choice = response.choices?.[0]
    if (!choice) {
      return { reasoning: 'API 返回为空', finalAnswer: '抱歉，服务暂时没有响应。' }
    }

    const toolCalls = choice.message?.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      const normalized = normalizeToolCalls(toolCalls)
      const first = normalized[0]
      return {
        reasoning: `模型决定调用工具 ${first.function.name}。`,
        action: { tool: first.function.name, args: parseArgs(first.function.arguments) },
        toolCalls: normalized,
      }
    }

    return {
      reasoning: '模型直接生成回答。',
      finalAnswer: choice.message?.content || '抱歉，我没有得到有效回复。',
    }
  }


  private buildMessages(context: MemoryItem[]): DeepSeekMessage[] {
    const messages: DeepSeekMessage[] = context.map((item) => {
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
            type: 'function' as const,
            function: tc.function,
          })),
        }
      }
      return {
        role: item.role === 'agent' ? 'assistant' : item.role,
        content: item.content,
      }
    })

    // 校验：确保每个 assistant tool_call 都有对应的 tool 消息，反之亦然
    const expectedIds = new Set<string>()
    const providedIds = new Set<string>()
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) expectedIds.add(tc.id)
      }
      if (msg.role === 'tool' && msg.tool_call_id) {
        providedIds.add(msg.tool_call_id)
      }
    }

    const result: DeepSeekMessage[] = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      // 孤立 tool 消息（没有对应 assistant tool_calls）→ 转为 user 消息保留内容
      if (msg.role === 'tool' && msg.tool_call_id && !expectedIds.has(msg.tool_call_id)) {
        result.push({ role: 'user', content: msg.content })
        continue
      }

      result.push(msg)

      // assistant 带 tool_calls → 补齐缺失的 tool 响应
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (!providedIds.has(tc.id)) {
            result.push({
              role: 'tool',
              content: '{}',
              tool_call_id: tc.id,
            })
          }
        }
      }
    }

    return result
  }

  private async chat(messages: DeepSeekMessage[], includeTools: boolean, toolsOverride?: Tool[]): Promise<DeepSeekResponse> {
    const body: Record<string, unknown> = { model: this.model, messages }
    const activeTools = toolsOverride ?? this.tools

    if (includeTools && activeTools.length > 0) {
      body.tools = activeTools.map((tool) => ({
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

    return apiPost<DeepSeekResponse>(`${this.baseURL}/chat/completions`, body, {
      Authorization: `Bearer ${this.apiKey}`,
    }, 120_000)
  }
}

function normalizeToolCalls(
  raw: Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined,
): Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> {
  return (raw || []).map((tc, index) => ({
    id: tc.id || `tool-call-${index + 1}`,
    type: 'function' as const,
    function: {
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '{}',
    },
  }))
}
