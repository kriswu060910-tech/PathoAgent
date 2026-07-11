import type { ImageAttachment } from '../vision'

export type GetImages = () => ImageAttachment[]

export const NO_IMAGE_MSG = '当前没有上传图片，请先上传图片再使用此工具。'

export const PATHO_HINT = '请确保病理分析后端已启动：`python server.py`'
export const CELLPOSE_HINT = '请确保 Cellpose 后端已启动：`cd cellpose && python server.py`'

let _serviceKey = ''
export function setServiceKey(key: string) { _serviceKey = key }
export function getServiceKey(): string { return _serviceKey }

/** 判断 URL 是否为本地后端（localhost / 相对路径），仅对这些请求携带 SERVICE_API_KEY */
function isLocalBackendUrl(url: string): boolean {
  if (url.startsWith('/')) return true
  if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) return true
  return false
}

/** 清洗 HTTP header 值，仅保留 RFC 7230 允许的可见 ASCII + 空格/制表符 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^\t\x20-\x7E]/g, '')
}

/** 清洗整个 headers 对象 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    cleaned[k] = sanitizeHeaderValue(v)
  }
  return cleaned
}

/** POST JSON 请求，统一处理错误响应。默认 30 秒超时。 */
export async function apiPost<T>(
  url: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders }
  if (_serviceKey && isLocalBackendUrl(url)) headers['Authorization'] = `Bearer ${_serviceKey}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: sanitizeHeaders(headers),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`API error ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`请求超时 (${timeoutMs / 1000}s)：${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** 安全解析 JSON 字符串为 Record<string, string> */
export function parseArgs(raw?: string): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')]),
    )
  } catch {
    return {}
  }
}

/** 安全解析可选浮点数参数 */
export function parseOptionalFloat(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = parseFloat(value)
  return isNaN(n) ? undefined : n
}

/** 多图遍历 + 错误处理通用模式 */
export async function processImages(
  images: ImageAttachment[],
  fn: (img: ImageAttachment, idx: number) => Promise<string>,
  errLabel: string,
): Promise<string> {
  const results: string[] = []
  for (let i = 0; i < images.length; i++) {
    try {
      results.push(await fn(images[i], i))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push(
        images.length > 1
          ? `**图片 ${i + 1}**：${errLabel}失败 — ${msg}`
          : `${errLabel}服务不可用 — ${msg}`,
      )
    }
  }
  return results.join('\n\n---\n\n')
}

/** 生成多图结果前缀 */
export function imagePrefix(total: number, idx: number, name: string): string {
  return total > 1 ? `**图片 ${idx + 1} (${name})**\n` : ''
}

/** 解析后端服务 URL：优先使用 settings 中的值，其次环境变量，最后 fallback 代理路径 */
export function resolveBackendUrl(settingsValue: string | undefined, envKey: string, fallbackProxy: string): string {
  if (settingsValue) return settingsValue
  const envVal = (import.meta as ImportMeta).env?.[envKey] as string | undefined
  return envVal || fallbackProxy
}
