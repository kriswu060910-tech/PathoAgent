/**
 * 视觉识别服务：调用 OpenAI 兼容的多模态 API 分析图片内容。
 *
 * 需要配置环境变量：
 *   VITE_VISION_BASE_URL  - API 地址（如 https://api.openai.com/v1）
 *   VITE_VISION_API_KEY   - API Key
 *   VITE_VISION_MODEL     - 模型名称（如 gpt-4o、qwen-vl-plus）
 */

export interface ImageAttachment {
  /** base64 data URL: data:image/jpeg;base64,... */
  dataUrl: string
  /** 文件名 */
  name: string
}

export function isVisionConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_VISION_BASE_URL && import.meta.env.VITE_VISION_API_KEY,
  )
}

export async function analyzeImage(image: ImageAttachment): Promise<string> {
  const baseUrl = (import.meta.env.VITE_VISION_BASE_URL as string) || ''
  const apiKey = (import.meta.env.VITE_VISION_API_KEY as string) || ''
  const model = (import.meta.env.VITE_VISION_MODEL as string) || 'gpt-4o'

  if (!baseUrl || !apiKey) {
    return '视觉服务未配置，请在 .env 中设置 VITE_VISION_BASE_URL 和 VITE_VISION_API_KEY。'
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '请详细描述这张图片的内容，包括主要元素、场景、文字（如有）等关键信息。',
              },
              {
                type: 'image_url',
                image_url: { url: image.dataUrl },
              },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[vision] API error:', response.status, text)
      return `视觉分析失败 (HTTP ${response.status})`
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content as string | undefined
    if (!content) throw new Error('Unexpected response format')
    return content
  } catch (error) {
    console.error('[vision] Error:', error)
    return '视觉分析出错，请稍后重试。'
  }
}

export async function analyzeImages(images: ImageAttachment[]): Promise<string> {
  if (images.length === 0) return ''

  if (!isVisionConfigured()) {
    return '（用户附带了图片，但视觉服务未配置）'
  }

  const descriptions = await Promise.all(
    images.map(async (img, i) => {
      const desc = await analyzeImage(img)
      return images.length === 1 ? `[图片内容] ${desc}` : `[图片${i + 1}: ${img.name}] ${desc}`
    }),
  )

  return descriptions.join('\n\n')
}
