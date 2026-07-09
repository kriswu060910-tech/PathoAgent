import { ConversationMemory } from './memory'
import { DeepSeekLLM, SimpleLLM } from './llm'
import { builtinTools } from './tools'
import { analyzeImages, type ImageAttachment } from './vision'
import type { AgentConfig, AgentEvent, LLM, MemoryItem, Tool } from './types'

export * from './types'
export { ConversationMemory } from './memory'
export { DeepSeekLLM, SimpleLLM } from './llm'
export {
  builtinTools,
  calculatorTool,
  datetimeTool,
  weatherTool,
  webSearchTool,
  createWebSearchTool,
} from './tools'
export { analyzeImage, analyzeImages, isVisionConfigured } from './vision'

const DEFAULT_SYSTEM_PROMPT = `你是 Cookie，一个最小化 React Agent。
你遵循 ReAct 循环：感知用户输入 → 思考是否需要工具 → 调用工具观察结果 → 给出最终回答。
当前可用工具：calculator（计算）、datetime（时间）、weather（天气）、web_search（联网搜索）。
当用户询问时事、最新信息、具体事实或你不太确定的内容时，优先使用 web_search。
当用户发送图片时，图片内容会自动分析并附加在上下文中，请根据图片分析结果回答用户的问题。`

export class ReactAgent {
  private memory: ConversationMemory
  private llm: LLM
  private tools: Map<string, Tool>
  private config: Required<AgentConfig>

  constructor(config: AgentConfig = {}, tools: Tool[] = builtinTools) {
    this.config = {
      systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      maxIterations: config.maxIterations ?? 3,
      showReasoning: config.showReasoning ?? true,
    }
    this.memory = new ConversationMemory(this.config.systemPrompt)
    this.llm = import.meta.env.VITE_API_KEY
      ? new DeepSeekLLM(tools)
      : new SimpleLLM(tools)
    this.tools = new Map(tools.map((t) => [t.name, t]))
  }

  /** 感知：把用户输入写入记忆 */
  perceive(input: string): void {
    this.memory.add('user', input)
  }

  /** 执行一次完整的 ReAct 循环，通过 onEvent 流式输出过程与结果 */
  async run(
    input: string,
    onEvent?: (event: AgentEvent) => void,
    options?: { enableSearch?: boolean; images?: ImageAttachment[] },
  ): Promise<string> {
    let perceivedInput = input

    if (options?.images && options.images.length > 0) {
      onEvent?.({ type: 'thought', content: '正在分析图片…' })
      const desc = await analyzeImages(options.images)
      perceivedInput = desc
        ? `${input}\n\n--- 图片分析结果 ---\n${desc}`
        : input
    }

    this.perceive(perceivedInput)

    const enableSearch = options?.enableSearch ?? true
    const activeTools = enableSearch
      ? [...this.tools.values()]
      : [...this.tools.values()].filter((t) => t.name !== 'web_search')

    for (let i = 0; i < this.config.maxIterations; i++) {
      const thought = await this.llm.think(this.memory.getContext(), activeTools)

      if (this.config.showReasoning) {
        onEvent?.({ type: 'thought', content: `思考：${thought.reasoning}` })
      }

      if (thought.action) {
        // 先写入 assistant 的 tool_calls，再写入 tool 结果，符合 OpenAI/DeepSeek 协议
        if (thought.toolCalls?.length) {
          this.memory.add('agent', '', undefined, thought.toolCalls)
        }

        onEvent?.({ type: 'tool_call', content: `调用 ${thought.action.tool}`, payload: thought.action.args })

        const toolCallId = thought.toolCalls?.[0]?.id
        const observation = await this.act(thought.action.tool, thought.action.args, toolCallId)
        onEvent?.({ type: 'tool_result', content: `观察：${observation}` })

        const finalAnswer = await this.llm.answerWithObservation(this.memory.getContext(), observation, activeTools)
        this.memory.add('agent', finalAnswer)
        onEvent?.({ type: 'answer', content: finalAnswer })
        return finalAnswer
      }

      if (thought.finalAnswer) {
        this.memory.add('agent', thought.finalAnswer)
        onEvent?.({ type: 'answer', content: thought.finalAnswer })
        return thought.finalAnswer
      }
    }

    const fallback = '抱歉，我暂时无法处理这个请求。'
    this.memory.add('agent', fallback)
    onEvent?.({ type: 'answer', content: fallback })
    return fallback
  }

  /** 行动：执行工具调用 */
  private async act(toolName: string, args: Record<string, string>, toolCallId?: string): Promise<string> {
    const tool = this.tools.get(toolName)
    if (!tool) return `错误：找不到工具 ${toolName}`

    try {
      const result = await tool.execute(args)
      this.memory.add('tool', result, toolCallId || toolName)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.memory.add('tool', `工具调用失败：${message}`, toolCallId || toolName)
      return `工具调用失败：${message}`
    }
  }

  getContext(): MemoryItem[] {
    return this.memory.getContext()
  }

  reset(): void {
    this.memory.reset()
  }
}
