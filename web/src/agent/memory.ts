import type { MemoryItem } from './types'
import type { ImageAttachment } from './vision'
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
    images?: ImageAttachment[],
  ): MemoryItem {
    const item: MemoryItem = {
      id: generateId(),
      role,
      content,
      toolCallId,
      toolCalls,
      images,
      timestamp: Date.now(),
    }
    this.items.push(item)

    // 滑动窗口：超出上限时保留 system prompt + 最近的对话，并释放旧图片数据
    if (this.items.length > this.maxItems) {
      const system = this.items.find((i) => i.role === 'system')
      const cutoff = this.items.length - this.maxItems + (system ? 1 : 0)
      const evicted = this.items.slice(0, cutoff)
      for (const item of evicted) {
        if (item.images) item.images = undefined
      }
      const recent = this.items.slice(-this.maxItems + (system ? 1 : 0))
      this.items = system ? [system, ...recent] : recent
    }

    return item
  }

  getContext(): MemoryItem[] {
    return [...this.items]
  }

  getLastImages(): import('./vision').ImageAttachment[] {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      if (item.role === 'user' && item.images?.length) {
        return item.images
      }
    }
    return []
  }

  last(): MemoryItem | undefined {
    return this.items[this.items.length - 1]
  }

  reset(): void {
    const system = this.items.find((item) => item.role === 'system')
    this.items = system ? [{ ...system }] : []
  }
}
