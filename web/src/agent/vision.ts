/**
 * 视觉识别服务：调用 OpenAI 兼容的多模态 API 分析图片内容。
 *
 * 需要配置环境变量：
 *   VITE_VISION_BASE_URL  - API 地址（如 https://api.openai.com/v1）
 *   VITE_VISION_API_KEY   - API Key
 *   VITE_VISION_MODEL     - 模型名称（如 gpt-4o、qwen-vl-plus）
 */

import { segmentBoxes } from './edgeDetection'
import { apiPost } from './tools/shared'
import type { MessageAttachment, AnnotationBox } from '../types/agent'

export type ImageAttachment = MessageAttachment

export interface VisionConfig {
  baseURL?: string
  apiKey?: string
  model?: string
}

function resolveVisionConfig(cfg?: VisionConfig) {
  return {
    baseURL: cfg?.baseURL || (import.meta.env.VITE_VISION_BASE_URL as string) || '',
    apiKey: cfg?.apiKey || (import.meta.env.VITE_VISION_API_KEY as string) || '',
    model: cfg?.model || (import.meta.env.VITE_VISION_MODEL as string) || 'gpt-4o',
  }
}

export function isVisionConfigured(cfg?: VisionConfig): boolean {
  const { baseURL, apiKey } = resolveVisionConfig(cfg)
  return Boolean(baseURL && apiKey)
}

const DEFAULT_PROMPT = '请详细描述这张图片的内容，包括主要元素、场景、文字（如有）等关键信息。'

export async function analyzeImage(image: ImageAttachment, prompt?: string, cfg?: VisionConfig): Promise<string> {
  const { baseURL, apiKey, model } = resolveVisionConfig(cfg)

  if (!baseURL || !apiKey) {
    throw new Error('视觉服务未配置，请在设置中配置视觉 API 地址和密钥。')
  }

  const data = await apiPost<VisionResponse>(`${baseURL}/chat/completions`, {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt || DEFAULT_PROMPT },
          { type: 'image_url', image_url: { url: image.dataUrl } },
        ],
      },
    ],
    max_tokens: 1024,
  }, { Authorization: `Bearer ${apiKey}` }, 120_000)

  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('Unexpected response format')
  return content
}

interface VisionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export type BoundingBox = AnnotationBox

const GROUNDING_PROMPT = `请检测图中所有显著物体，以严格的 JSON 数组返回，不要包含任何其他文字或 markdown 标记。
格式：[{"label":"物体名称","x":左上角x比例,"y":左上角y比例,"width":宽度比例,"height":高度比例,"points":[{"x":x1,"y":y1},{"x":x2,"y":y2},...],"color":"#hex"}]
坐标为 0 到 1 之间的浮点数，表示相对于图片尺寸的比例位置。
points 为沿物体轮廓的近似多边形顶点（4-8 个点即可，无需精确贴边），按顺时针或逆时针顺序排列。
x, y, width, height 为包含该物体的最小外接矩形。
color 为可选的十六进制颜色值（如 "#ef4444"），用于区分不同类型的物体。如果不需要区分颜色可省略。`

export async function detectObjects(
  image: ImageAttachment,
  customPrompt?: string,
  cfg?: VisionConfig,
): Promise<BoundingBox[]> {
  const prompt = customPrompt || GROUNDING_PROMPT
  const raw = await analyzeImage(image, prompt, cfg)
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned) as Array<Record<string, unknown>>
    return parsed
      .filter((item) => typeof item.label === 'string')
      .map((item) => {
        const apiPoints = parsePoints(item.points)
        const x = clamp01(Number(item.x) || 0)
        const y = clamp01(Number(item.y) || 0)
        const w = clamp01(Number(item.width) || 0.1)
        const h = clamp01(Number(item.height) || 0.1)
        const color = typeof item.color === 'string' ? item.color as string : undefined
        return {
          label: item.label as string,
          x, y, width: w, height: h,
          confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
          color,
          points: apiPoints.length >= 3
            ? apiPoints
            : generateEllipsePoints(x, y, w, h),
        }
      })
  } catch {
    console.warn('[vision] Failed to parse grounding result:', raw)
    return []
  }
}

function parsePoints(raw: unknown): { x: number; y: number }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({ x: clamp01(Number(p.x) || 0), y: clamp01(Number(p.y) || 0) }))
    .filter((p) => p.x >= 0 && p.y >= 0)
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * 根据外接矩形生成椭圆多边形顶点（12 个点），
 * 在模型无法返回边缘坐标时作为 fallback 近似物体轮廓。
 * rx/ry 收缩系数让多边形略小于矩形，视觉上更贴合物体边缘。
 */
function generateEllipsePoints(
  x: number, y: number, w: number, h: number, sides = 12,
): { x: number; y: number }[] {
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2
  const ry = h / 2
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2
    points.push({
      x: clamp01(cx + rx * Math.cos(angle)),
      y: clamp01(cy + ry * Math.sin(angle)),
    })
  }
  return points
}

/* ------------------------------------------------------------------ */
/*  边缘检测 + LLM 融合标注                                             */
/* ------------------------------------------------------------------ */

/**
 * 融合区域分割与 LLM 标签识别的物体标注。
 *
 * 流程：
 *  1. LLM 识别物体 → 标签 + 粗略外接矩形（单次调用）
 *  2. 对每个检测框，在框内做区域分割：
 *     Canny 边缘（屏障）+ 颜色概率图（前景/背景直方图）+ BFS 填充
 *  3. 提取精确的物体蒙版轮廓多边形
 *  4. 分割失败时回退到 LLM 多边形或椭圆近似
 */
export async function detectObjectsWithEdges(
  image: ImageAttachment,
  customPrompt?: string,
  cfg?: VisionConfig,
): Promise<BoundingBox[]> {
  // 第一步：LLM 检测（获取标签 + 粗略框）
  const llmBoxes = await detectObjects(image, customPrompt, cfg)
  if (llmBoxes.length === 0) return []

  // 第二步：对每个 LLM 框做区域分割，获取精确边缘多边形
  const segResults = await segmentBoxes(
    image.dataUrl,
    llmBoxes.map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height })),
  )

  return llmBoxes.map((box, i) => {
    const segPoints = segResults[i]
    if (segPoints && segPoints.length >= 3) {
      return { ...box, points: segPoints }
    }
    // 分割失败 → 回退到 LLM 多边形或椭圆
    return {
      ...box,
      points: box.points && box.points.length >= 3
        ? box.points
        : generateEllipsePoints(box.x, box.y, box.width, box.height),
    }
  })
}

export async function analyzeImages(images: ImageAttachment[], prompt?: string, cfg?: VisionConfig): Promise<string> {
  if (images.length === 0) return ''

  if (!isVisionConfigured(cfg)) {
    return '（用户附带了图片，但视觉服务未配置）'
  }

  const results = await Promise.allSettled(
    images.map(async (img, i) => {
      const desc = await analyzeImage(img, prompt, cfg)
      return images.length === 1 ? `[图片内容] ${desc}` : `[图片${i + 1}: ${img.name}] ${desc}`
    }),
  )

  const descriptions: string[] = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      descriptions.push(result.value)
    } else {
      const label = images.length === 1 ? '图片' : `图片${i + 1}: ${images[i].name}`
      descriptions.push(`[${label}] 分析失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
    }
  })

  return descriptions.join('\n\n')
}
