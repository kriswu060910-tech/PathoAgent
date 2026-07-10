import type { Tool } from '../types'
import { apiPost } from './shared'

/**
 * WebSearch：联网搜索工具包。
 *
 * 支持多供应商切换，默认读取环境变量：
 * - VITE_SEARCH_PROVIDER：搜索供应商，可选 duckduckgo / tavily / serper / mock
 * - VITE_SEARCH_API_KEY：对应供应商的 API Key（duckduckgo 免费，无需 Key）
 * - VITE_SEARCH_MAX_RESULTS：单次返回结果数量，默认 5
 * - VITE_CORS_PROXY：浏览器端调用 duckduckgo 时所需的 CORS 代理前缀（开发环境可留空，由 Vite 代理处理）
 *
 * 默认策略：
 * - 显式配置了供应商则优先使用
 * - 配置了 API Key 但未指定供应商时默认使用 tavily
 * - 开发环境未配置时默认使用免费的 duckduckgo（走 Vite 代理）
 * - 生产环境未配置时回退到 mock 模式
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchConfig {
  /** 搜索供应商 */
  provider?: 'duckduckgo' | 'tavily' | 'serper' | 'mock'
  /** API Key（tavily / serper 需要；duckduckgo 免费） */
  apiKey?: string
  /** 最大返回结果数 */
  maxResults?: number
}

export function createWebSearchTool(config?: WebSearchConfig): Tool {
  const apiKey = config?.apiKey || import.meta.env.VITE_SEARCH_API_KEY || ''
  const provider = resolveProvider(config?.provider, apiKey)
  const maxResults = config?.maxResults || Number(import.meta.env.VITE_SEARCH_MAX_RESULTS) || 5

  return {
    name: 'web_search',
    description:
      '搜索互联网获取实时信息。当用户询问时事新闻、最新动态、具体事实、股价、赛事、天气实况或任何可能随时间变化的外部数据时使用。',
    parameters: {
      query: '搜索关键词，例如 "2024 巴黎奥运会金牌榜"、"React 19 新特性"',
    },
    async execute(args) {
      const query = (args.query || '').trim()
      if (!query) return '搜索关键词为空，请提供具体的搜索内容。'

      try {
        const results = await performSearch(query, provider, apiKey, maxResults)
        return formatResults(results)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `搜索失败：${message}`
      }
    },
  }
}

export const webSearchTool: Tool = createWebSearchTool()

function resolveProvider(provider?: string, apiKey?: string): WebSearchConfig['provider'] {
  const value = provider || import.meta.env.VITE_SEARCH_PROVIDER
  if (value === 'duckduckgo' || value === 'mock') {
    return value
  }
  // tavily / serper 需要 API Key，没有则回退到 duckduckgo
  if ((value === 'tavily' || value === 'serper') && apiKey) {
    return value
  }
  if (apiKey) return 'tavily'
  if (import.meta.env.DEV) return 'duckduckgo'
  // 生产环境：有 Key 用 tavily，没有用 duckduckgo（走 CORS 代理）
  return 'duckduckgo'
}

async function performSearch(
  query: string,
  provider: WebSearchConfig['provider'],
  apiKey: string,
  maxResults: number,
): Promise<SearchResult[]> {
  switch (provider) {
    case 'duckduckgo':
      return searchDuckDuckGo(query, maxResults)
    case 'tavily':
      return searchTavily(query, apiKey, maxResults)
    case 'serper':
      return searchSerper(query, apiKey, maxResults)
    case 'mock':
    default:
      return searchMock(query, maxResults)
  }
}

async function searchTavily(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  if (!apiKey) {
    throw new Error('使用 Tavily 搜索需要配置 VITE_SEARCH_API_KEY。')
  }

  const data = await apiPost<TavilyResponse>('https://api.tavily.com/search', {
    api_key: apiKey,
    query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: false,
  })

  return (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || r.snippet || '',
  }))
}

interface TavilyResponse {
  results?: Array<{
    title?: string
    url?: string
    content?: string
    snippet?: string
  }>
}

async function searchSerper(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  if (!apiKey) {
    throw new Error('使用 Serper 搜索需要配置 VITE_SEARCH_API_KEY。')
  }

  const data = await apiPost<SerperResponse>('https://google.serper.dev/search', {
    q: query, num: maxResults,
  }, { 'X-API-KEY': apiKey })

  return (data.organic || []).map((r) => ({
    title: r.title || '',
    url: r.link || r.url || '',
    snippet: r.snippet || '',
  }))
}

interface SerperResponse {
  organic?: Array<{
    title?: string
    link?: string
    url?: string
    snippet?: string
  }>
}

/**
 * DuckDuckGo 搜索（免费，无需 API Key）。
 *
 * 说明：
 * - 开发环境走 Vite 代理，可直接使用。
 * - 生产环境使用内置 CORS 代理（corsproxy.io），无需额外配置。
 * - 用户可通过 VITE_CORS_PROXY 覆盖默认代理地址。
 */
const DEFAULT_CORS_PROXY = 'https://corsproxy.io/?'

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const corsProxy = import.meta.env.VITE_CORS_PROXY || DEFAULT_CORS_PROXY

  let url: string
  if (import.meta.env.DEV) {
    url = `/api/search/duckduckgo?q=${encodeURIComponent(query)}`
  } else {
    url = `${corsProxy}${encodeURIComponent(target)}`
  }

  const res = await fetch(url, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const tip = res.status === 403
      ? '（DuckDuckGo 可能拦截了请求，建议配置 VITE_CORS_PROXY）'
      : ''
    throw new Error(`DuckDuckGo ${res.status} ${tip}`)
  }

  const html = await res.text()
  return parseDuckDuckGoHtml(html, maxResults)
}

function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const results: SearchResult[] = []

  doc.querySelectorAll('.result').forEach((item) => {
    if (results.length >= maxResults) return

    const titleEl = item.querySelector('.result__a')
    const snippetEl = item.querySelector('.result__snippet')
    const urlEl = item.querySelector('.result__url')
    if (!titleEl) return

    const title = titleEl.textContent?.trim() || ''
    const snippet = snippetEl?.textContent?.trim() || ''
    const displayUrl = urlEl?.textContent?.trim() || ''
    const rawUrl = (titleEl as HTMLAnchorElement).href || ''
    const url = decodeDuckDuckGoUrl(rawUrl) || displayUrl || rawUrl

    results.push({ title, url, snippet })
  })

  return results
}

function decodeDuckDuckGoUrl(url: string): string | null {
  try {
    if (url.includes('duckduckgo.com/l/')) {
      const parsed = new URL(url)
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) return decodeURIComponent(uddg)
    }
  } catch {
    // ignore
  }
  return null
}

async function searchMock(query: string, maxResults: number): Promise<SearchResult[]> {
  // mock 模式下模拟一次短暂延迟，让交互更真实
  await new Promise((resolve) => setTimeout(resolve, 300))
  return [
    {
      title: `关于 "${query}" 的搜索结果（演示模式）`,
      url: 'https://example.com',
      snippet: '当前处于 mock 模式。如需真实联网搜索，请在 .env 中配置 VITE_SEARCH_PROVIDER 和 VITE_SEARCH_API_KEY。',
    },
    ...Array.from({ length: Math.max(0, maxResults - 1) }, (_, i) => ({
      title: `演示结果 ${i + 1}`,
      url: `https://example.com/result-${i + 1}`,
      snippet: `这是第 ${i + 1} 条模拟搜索结果，仅用于验证 Agent 的工具调用链路。`,
    })),
  ]
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return '未找到相关结果。'
  }

  return results
    .map((r, index) => `${index + 1}. ${r.title}\n链接：${r.url}\n摘要：${r.snippet}`)
    .join('\n\n')
}
