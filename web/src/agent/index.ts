import { ConversationMemory } from './memory'
import { DeepSeekLLM, SimpleLLM } from './llm'
import { builtinTools, createVisionTools, createPathologyTools, createCellposeTools } from './tools'
import { type ImageAttachment } from './vision'
import type { AgentConfig, AgentEvent, AnnotationBox, LLM, MemoryItem, Thought, Tool } from './types'
import { parseArgs } from './tools/shared'

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

const DEFAULT_SYSTEM_PROMPT = `你是 Cookie，一个专注于病理图像分析的 AI Agent。
你遵循 ReAct 循环：感知用户输入 → 思考是否需要工具 → 调用工具观察结果 → 给出最终回答。
当前可用工具：calculator（计算）、datetime（时间）、web_search（联网搜索）、extract_text（提取图片文字）、annotate_objects（沿边缘标注物体）、pathology_analyze（病理图像分析，支持区域聚焦）、pathology_compare（病理图像对比）、pathology_report（生成结构化诊断报告）、cell_segment（Cellpose 细胞分割计数）、cell_measure（细胞形态学测量）。
当用户询问医学知识、最新研究或临床指南时，使用 web_search 查找可靠来源。
当用户上传病理图像（组织切片、细胞涂片、免疫组化等）时：
- 常规分析诊断用 pathology_analyze
- 分析特定区域细节用 pathology_analyze 并指定 region 参数
- 对比多张切片用 pathology_compare
- 需要正式诊断报告用 pathology_report
- 标注病变区域用 annotate_objects
- 提取报告中的文字用 extract_text
当用户需要细胞级别的定量分析时：
- 细胞计数、分割、定位用 cell_segment
- 细胞面积、圆度、形态学测量用 cell_measure
不要使用通用视觉工具分析病理图像，始终优先使用病理专用工具。`

export class ReactAgent {
  private memory: ConversationMemory
  private llm: LLM
  private tools: Map<string, Tool>
  private config: Required<AgentConfig>
  private currentImages: ImageAttachment[] = []
  private pendingAnnotations: AnnotationBox[] = []

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
    this.tools = new Map([
      ...tools.map((t): [string, Tool] => [t.name, t]),
      ...createVisionTools(
        () => this.currentImages,
        (boxes) => { this.pendingAnnotations = boxes },
      ).map((t): [string, Tool] => [t.name, t]),
      ...createPathologyTools(() => this.currentImages).map((t): [string, Tool] => [t.name, t]),
      ...createCellposeTools(() => this.currentImages).map((t): [string, Tool] => [t.name, t]),
    ])
  }

  /** 执行一次完整的 ReAct 循环，通过 onEvent 流式输出过程与结果 */
  async run(
    input: string,
    onEvent?: (event: AgentEvent) => void,
    options?: { enableSearch?: boolean; images?: ImageAttachment[] },
  ): Promise<string> {
    this.currentImages = options?.images ?? []
    const perceivedInput = this.currentImages.length > 0
      ? `${input}\n\n（用户附带了 ${this.currentImages.length} 张图片，请使用合适的视觉工具进行分析）`
      : input
    this.memory.add('user', perceivedInput)

    const activeTools = this.getActiveTools(options?.enableSearch ?? true)

    for (let i = 0; i < this.config.maxIterations; i++) {
      const isLastIteration = i === this.config.maxIterations - 1
      // 最后一轮不提供工具，迫使 LLM 直接给出最终答案
      const iterationTools = isLastIteration ? [] : activeTools
      const thought = await this.llm.think(this.memory.getContext(), iterationTools)

      if (this.config.showReasoning) {
        onEvent?.({ type: 'thought', content: `思考：${thought.reasoning}` })
      }

      if (thought.finalAnswer && !thought.action) {
        return this.finalize(thought.finalAnswer, onEvent)
      }

      if (thought.action && !isLastIteration) {
        await this.executeToolCalls(thought, onEvent)
        continue
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

