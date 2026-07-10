import type { AgentRequest, AgentResponse, AgentService, AnnotationBox } from '../types/agent'
import { ReactAgent } from '../agent'
import type { AgentConfig } from '../agent'
import type { AppSettings } from '../stores/settings'
import { getSettings, onSettingsChange } from '../stores/settings'

export function buildAgentConfig(settings: AppSettings): AgentConfig {
  return {
    apiConfig: {
      apiKey: settings.apiKey || undefined,
      baseURL: settings.baseURL || undefined,
      model: settings.model || undefined,
    },
    visionConfig: {
      baseURL: settings.visionBaseUrl || undefined,
      apiKey: settings.visionApiKey || undefined,
      model: settings.visionModel || undefined,
    },
    searchConfig: {
      provider: settings.searchProvider || undefined,
      apiKey: settings.searchApiKey || undefined,
    },
    backendUrls: {
      patho: settings.pathoApiUrl || undefined,
      cellpose: settings.cellposeApiUrl || undefined,
      launcher: settings.launcherApiUrl || undefined,
    },
  }
}

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
  private settingsSnapshot = getSettings()

  private getAgent(conversationId: string): ReactAgent {
    if (!this.agents.has(conversationId)) {
      this.agents.set(conversationId, new ReactAgent(buildAgentConfig(this.settingsSnapshot)))
    }
    return this.agents.get(conversationId)!
  }

  /** 设置变更时调用，清除所有缓存的 Agent 以便用新配置重建 */
  reconfigure(settings: AppSettings): void {
    this.settingsSnapshot = settings
    this.agents.clear()
  }

  /** @deprecated 使用 reconfigure(settings) */
  resetAllAgents(): void {
    this.reconfigure(getSettings())
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

// 设置变更时自动重置所有缓存的 Agent
onSettingsChange((settings) => {
  if (agentService instanceof AgentServiceImpl) {
    agentService.reconfigure(settings)
  }
})
