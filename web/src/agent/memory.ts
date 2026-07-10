import type { MemoryItem } from './types'
import { generateId } from '../utils'

/**
 * ConversationMemory：Agent 的短期记忆。
 *
 * 负责：
 * - 存储用户输入、Agent 输出、工具观察结果
 * - 按时间顺序提供上下文给 LLM
 * - 支持单会话重置
 */
export class ConversationMemory {
  private items: MemoryItem[] = []
  private readonly maxItems: number

  constructor(systemPrompt?: string, maxItems = 60) {
    this.maxItems = maxItems
    if (systemPrompt) {
      this.items.push({
        id: generateId(),
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      })
    }
  }

  add(
    role: MemoryItem['role'],
    content: string,
    toolCallId?: string,
    toolCalls?: MemoryItem['toolCalls'],
  ): MemoryItem {
    const item: MemoryItem = {
      id: generateId(),
      role,
      content,
      toolCallId,
      toolCalls,
      timestamp: Date.now(),
    }
    this.items.push(item)

    // 滑动窗口：超出上限时保留 system prompt + 最近的对话
    if (this.items.length > this.maxItems) {
      const system = this.items.find((i) => i.role === 'system')
      const recent = this.items.slice(-this.maxItems + (system ? 1 : 0))
      this.items = system ? [system, ...recent] : recent
    }

    return item
  }

  getContext(): MemoryItem[] {
    return [...this.items]
  }

  last(): MemoryItem | undefined {
    return this.items[this.items.length - 1]
  }

  reset(): void {
    const system = this.items.find((item) => item.role === 'system')
    this.items = system ? [{ ...system }] : []
  }
}
