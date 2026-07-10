import type { AgentRequest, AgentResponse, AgentService, AnnotationBox } from '../types/agent'
import { ReactAgent } from '../agent'

/**
 * 使用 ReactAgent 替换原来的 MockAgentService。
 *
 * ReactAgent 包含 Agent 的完整组成部分：
 * - Perception（感知）
 * - Memory（记忆）
 * - Brain/LLM（认知）
 * - Tools（工具/行动）
 * - Action（输出）
 *
 * 每个对话实例持有一个独立的 Agent，保证上下文隔离。
 */
export class AgentServiceImpl implements AgentService {
  private agents = new Map<string, ReactAgent>()

  private getAgent(conversationId: string): ReactAgent {
    if (!this.agents.has(conversationId)) {
      this.agents.set(conversationId, new ReactAgent())
    }
    return this.agents.get(conversationId)!
  }

  removeAgent(conversationId: string): void {
    this.agents.delete(conversationId)
  }

  async sendMessage(request: AgentRequest): Promise<AgentResponse> {
    const { answer, annotations } = await this.runWithAgent(request)
    return {
      content: answer,
      done: true,
      annotations,
    }
  }

  async streamMessage(
    request: AgentRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    let answer = ''
    await this.runWithAgent(request, (event) => {
      if (event.type === 'answer') {
        const chunk = event.content.slice(answer.length)
        answer = event.content
        onChunk(chunk)
      }
    })
  }

  getAnnotations(conversationId: string) {
    return this.agents.get(conversationId)?.getAnnotations() ?? []
  }

  private async runWithAgent(
    request: AgentRequest,
    onEvent?: (event: import('../agent').AgentEvent) => void,
  ): Promise<{ answer: string; annotations: AnnotationBox[] | undefined }> {
    const agent = this.getAgent(request.conversationId)
    agent.clearAnnotations()
    const images = request.images?.map((img) => ({ dataUrl: img.dataUrl, name: img.name, type: 'image' as const }))
    const answer = await agent.run(request.content, onEvent, {
      enableSearch: request.enableSearch,
      images,
    })
    const annotations = agent.getAnnotations()
    return { answer, annotations: annotations.length > 0 ? annotations : undefined }
  }
}

export const agentService: AgentService = new AgentServiceImpl()
