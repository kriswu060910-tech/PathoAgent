import { ConversationMemory } from './memory'
import { DeepSeekLLM, SimpleLLM } from './llm'
import { builtinTools, createVisionTools, createPathologyTools, createCellposeTools, createWebSearchTool } from './tools'
import { type ImageAttachment } from './vision'
import type { AgentConfig, AgentEvent, AnnotationBox, LLM, MemoryItem, Thought, Tool } from './types'
import { parseArgs } from './tools/shared'
import { DEFAULT_SYSTEM_PROMPT } from './systemPrompt'

export * from './types'
export { ConversationMemory } from './memory'
export { DeepSeekLLM, SimpleLLM } from './llm'
export {
  builtinTools,
  calculatorTool,
  datetimeTool,
  webSearchTool,
  createWebSearchTool,
  createVisionTools,
  createPathologyTools,
  createCellposeTools,
} from './tools'
export { analyzeImage, analyzeImages, detectObjects, isVisionConfigured } from './vision'
export type { BoundingBox } from './vision'
export { DEFAULT_SYSTEM_PROMPT } from './systemPrompt'

export class ReactAgent {
  private memory: ConversationMemory
  private llm: LLM
  private tools: Map<string, Tool>
  private config: AgentConfig
  private currentImages: ImageAttachment[] = []
  private pendingAnnotations: AnnotationBox[] = []

  constructor(config: AgentConfig = {}, tools: Tool[] = builtinTools) {
    this.config = {
      ...config,
      systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      maxIterations: config.maxIterations ?? 3,
      showReasoning: config.showReasoning ?? true,
    }
    this.memory = new ConversationMemory(this.config.systemPrompt)

    const hasApiKey = Boolean(config.apiConfig?.apiKey || import.meta.env.VITE_API_KEY)
    this.llm = hasApiKey
      ? new DeepSeekLLM(tools, config.apiConfig)
      : new SimpleLLM(tools)

    const visionCfg = config.visionConfig
    const backendCfg = config.backendUrls
    const searchCfg = config.searchConfig

    this.tools = new Map([
      ...tools.map((t): [string, Tool] => [t.name, t]),
      ...createVisionTools(
        () => this.currentImages,
        (boxes) => { this.pendingAnnotations = boxes },
        visionCfg,
      ).map((t): [string, Tool] => [t.name, t]),
      ...createPathologyTools(() => this.currentImages, backendCfg?.patho).map((t): [string, Tool] => [t.name, t]),
      ...createCellposeTools(() => this.currentImages, backendCfg?.cellpose).map((t): [string, Tool] => [t.name, t]),
    ])

    // 搜索工具需要用运行时配置重建（支持 localStorage 中的 provider/apiKey）
    if (searchCfg?.provider || searchCfg?.apiKey) {
      const searchTool = createWebSearchTool({
        provider: searchCfg.provider as 'duckduckgo' | 'tavily' | 'serper' | 'mock' | undefined,
        apiKey: searchCfg.apiKey,
      })
      this.tools.set('web_search', searchTool)
    }
  }

  /** 执行一次完整的 ReAct 循环，通过 onEvent 流式输出过程与结果 */
  async run(
    input: string,
    onEvent?: (event: AgentEvent) => void,
    options?: { enableSearch?: boolean; images?: ImageAttachment[] },
  ): Promise<string> {
    if (options?.images?.length) {
      this.currentImages = options.images
    } else {
      this.currentImages = this.memory.getLastImages()
    }
    const perceivedInput = this.currentImages.length > 0 && !options?.images?.length
      ? `${input}\n\n（用户之前附带了 ${this.currentImages.length} 张图片，请使用合适的视觉工具继续分析）`
      : this.currentImages.length > 0
        ? `${input}\n\n（用户附带了 ${this.currentImages.length} 张图片，请使用合适的视觉工具进行分析）`
        : input
    this.memory.add('user', perceivedInput, undefined, undefined, options?.images?.length ? options.images : undefined)

    const activeTools = this.getActiveTools(options?.enableSearch ?? true)

    for (let i = 0; i < (this.config.maxIterations ?? 3); i++) {
      const isLastIteration = i === (this.config.maxIterations ?? 3) - 1
      // 最后一轮不提供工具，迫使 LLM 直接给出最终答案
      const iterationTools = isLastIteration ? [] : activeTools
      const thought = await this.llm.think(this.memory.getContext(), iterationTools)

      if (this.config.showReasoning ?? true) {
        onEvent?.({ type: 'thought', content: `思考：${thought.reasoning}` })
      }

      if (thought.finalAnswer && !thought.action) {
        return this.finalize(thought.finalAnswer, onEvent)
      }

      if (thought.action && !isLastIteration) {
        await this.executeToolCalls(thought, onEvent)
        continue
      }

      if (thought.action && isLastIteration) {
        return this.finalize(
          `我已尝试调用工具 ${thought.action.tool}，但已达到最大迭代次数。以下是我的推理过程：${thought.reasoning}`,
          onEvent,
        )
      }

      break
    }

    return this.finalize('抱歉，我暂时无法处理这个请求。', onEvent)
  }

  private getActiveTools(enableSearch: boolean): Tool[] {
    const all = [...this.tools.values()]
    return enableSearch ? all : all.filter((t) => t.name !== 'web_search')
  }

  private finalize(answer: string, onEvent?: (event: AgentEvent) => void): string {
    this.memory.add('agent', answer)
    onEvent?.({ type: 'answer', content: answer })
    return answer
  }

  private async executeToolCalls(thought: Thought, onEvent?: (event: AgentEvent) => void): Promise<void> {
    const toolCalls = thought.toolCalls ?? []
    if (toolCalls.length > 0) {
      this.memory.add('agent', '', undefined, toolCalls)
    }

    const calls = toolCalls.length > 0
      ? toolCalls.map((tc) => ({
          name: tc.function.name,
          args: parseArgs(tc.function.arguments),
          id: tc.id,
        }))
      : [{ name: thought.action!.tool, args: thought.action!.args, id: '' }]

    for (const call of calls) {
      onEvent?.({ type: 'tool_call', content: `调用 ${call.name}`, payload: call.args })
      const observation = await this.act(call.name, call.args, call.id || undefined)
      onEvent?.({ type: 'tool_result', content: `观察：${observation}` })
    }
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

  getAnnotations(): AnnotationBox[] {
    return this.pendingAnnotations
  }

  clearAnnotations(): void {
    this.pendingAnnotations = []
  }

  getContext(): MemoryItem[] {
    return this.memory.getContext()
  }

  reset(): void {
    this.memory.reset()
  }
}

