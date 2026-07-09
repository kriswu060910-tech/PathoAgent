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

  constructor(systemPrompt?: string) {
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
