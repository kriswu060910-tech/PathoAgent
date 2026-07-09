import type { AgentRequest, AgentResponse, AgentService } from '../types/agent'
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

  async sendMessage(request: AgentRequest): Promise<AgentResponse> {
    const agent = this.getAgent(request.conversationId)
    const answer = await agent.run(request.content)
    return { content: answer, done: true }
  }

  async streamMessage(
    request: AgentRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const agent = this.getAgent(request.conversationId)

    let answer = ''
    await agent.run(request.content, (event) => {
      if (event.type === 'answer') {
        const chunk = event.content.slice(answer.length)
        answer = event.content
        onChunk(chunk)
      }
    })
  }
}

export const agentService: AgentService = new AgentServiceImpl()
