import type { MemoryItem, Thought, Tool, LLM } from './types'

/**
 * SimpleLLM：离线规则版"大脑"，API key 缺失时作为兜底。
 * 通过正则匹配识别用户意图，模拟推理与决策。
 */
export class SimpleLLM implements LLM {
  constructor(_tools?: Tool[]) {
    // _tools 保留给未来扩展
  }

  async think(context: MemoryItem[]): Promise<Thought> {
    const lastUserMessage = [...context]
      .reverse()
      .find((item) => item.role === 'user')

    if (!lastUserMessage) {
      return {
        reasoning: '没有检测到用户输入，等待用户提问。',
        finalAnswer: '你好，我是 Cookie Agent，有什么可以帮你的吗？',
      }
    }

    const input = lastUserMessage.content
    const action = this.detectAction(input)

    if (action) {
      return {
        reasoning: `用户输入"${input}"，我判断需要调用 ${action.tool} 工具来获取准确结果。`,
        action,
      }
    }

    return {
      reasoning: `用户输入"${input}"，不需要工具，直接回答。`,
      finalAnswer: this.generateReply(input),
    }
  }

  async answerWithObservation(
    context: MemoryItem[],
    observation: string,
  ): Promise<string> {
    const lastUserMessage = [...context]
      .reverse()
      .find((item) => item.role === 'user')
    const question = lastUserMessage?.content || ''

    if (/\d[\d\s.+*/()-]*\d/.test(question) && /[+−*/()]/.test(question)) {
      return `计算结果是：${observation.replace(/^.*=\s*/, '')}`
    }
    if (question.includes('时间') || question.includes('几点')) {
      return `现在是 ${observation}。`
    }
    if (question.includes('天气')) {
      return observation
    }
    if (/搜索|查一下|网上|最新|新闻/.test(question)) {
      return `搜索结果如下：\n\n${observation}`
    }

    return `根据查询结果：${observation}`
  }

  private detectAction(input: string): { tool: string; args: Record<string, string> } | null {
    const text = input.trim()

    const calcMatch = text.match(/(\d[\d\s.+*/()-]*\d)/)
    if (calcMatch && /[+−*/()]/.test(calcMatch[1])) {
      return { tool: 'calculator', args: { expression: calcMatch[1].trim() } }
    }

    if (/现在几点|当前时间|今天几号|日期/.test(text)) {
      return { tool: 'datetime', args: { format: 'full' } }
    }

    const weatherMatch = text.match(/(.+?)天气/)
    if (weatherMatch) {
      return { tool: 'weather', args: { city: weatherMatch[1].trim() } }
    }

    const searchMatch = text.match(/(?:搜索|查一下|搜索一下|网上搜索)(.+)/)
    if (searchMatch) {
      return { tool: 'web_search', args: { query: searchMatch[1].trim() } }
    }

    return null
  }

  private generateReply(input: string): string {
    const lower = input.toLowerCase()
    if (lower.includes('hello') || lower.includes('你好')) {
      return '你好！我是 Cookie Agent，可以帮你计算、查时间、查天气，也可以陪你聊天。'
    }
    if (lower.includes('help') || lower.includes('帮助')) {
      return '你可以试试：\n- 计算 12 * 34\n- 现在几点\n- 北京天气\n- 随便聊聊'
    }
    if (lower.includes('agent') || lower.includes('项目')) {
      return '这是一个最简 React Agent 示例，包含感知、记忆、推理、工具、输出五个部分。'
    }
    return `收到你的消息："${input}"。\n\n我还在学习中，目前支持计算、时间、天气和简单闲聊。`
  }
}
