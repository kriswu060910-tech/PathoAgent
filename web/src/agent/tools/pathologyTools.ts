import type { Tool } from '../types'
import { apiPost, processImages, imagePrefix, PATHO_HINT, resolveBackendUrl } from './shared'
import type { GetImages } from './shared'
import { getSettings } from '../../stores/settings'

function getApiUrl(envUrl?: string): string {
  return resolveBackendUrl(envUrl ?? getSettings().pathoApiUrl, 'VITE_PATHO_API_URL', '/api/patho')
}

async function callPathoAPI(baseUrl: string, image: string, question: string, style: string): Promise<{
  thinking: string
  answer: string
  raw: string
}> {
  return apiPost(`${baseUrl}/analyze`, { image, question, style })
}

export function createPathologyTools(getImages: GetImages, apiUrl?: string): Tool[] {
  return [
    {
      name: 'pathology_analyze',
      description:
        '分析病理图像（组织切片、细胞涂片等），提供专业诊断推理。可分析全图或聚焦特定区域。当用户要求"分析病理""诊断切片""分析这个区域"时使用。',
      parameters: {
        question: '可选，具体的分析问题，例如"这张切片是否有恶性肿瘤特征"',
        region: '可选，聚焦分析特定区域，例如"左上角的细胞簇""中央的血管周围"',
        style: '可选，推理风格："cot"（详细逐步推理，默认）或 "cod"（简洁推理）',
      },
      async execute(args) {
        const images = getImages()
        if (!images.length) return '请先上传病理图像再进行分析。'

        const baseUrl = getApiUrl(apiUrl)
        const style = args.style === 'cod' ? 'cod' : 'cot'
        let question = args.question || '请分析这张病理图像，描述所见并给出诊断意见。'
        if (args.region) {
          question = `请聚焦分析图像中「${args.region}」，详细描述该区域的细胞形态、组织结构、染色特征和任何异常发现。${args.question ? `具体回答：${args.question}` : ''}`
        }

        return processImages(images, async (image, idx) => {
          const { thinking, answer } = await callPathoAPI(baseUrl, image.dataUrl, question, style)
          const prefix = imagePrefix(images.length, idx, image.name)
          if (args.region) {
            return `${prefix}**区域：** ${args.region}\n\n**推理过程：**\n${thinking}\n\n**区域分析：**\n${answer}`
          }
          return `${prefix}**推理过程：**\n${thinking}\n\n**诊断意见：**\n${answer}`
        }, '病理分析')
      },
    },
    {
      name: 'pathology_compare',
      description:
        '对比多张病理图像的差异。需要上传至少 2 张病理图片。当用户要求"对比切片""比较多张病理图"时使用。',
      parameters: {
        focus: '可选，对比重点，例如"细胞形态""组织结构的差异"',
      },
      async execute(args) {
        const images = getImages()
        if (images.length < 2) return '对比功能需要至少上传 2 张病理图片。'

        const baseUrl = getApiUrl(apiUrl)
        const focus = args.focus || '病理特征差异'

        const results = await processImages(images, async (image, idx) => {
          const question = `请详细分析这张病理图像，重点关注${focus}方面的特征。`
          const { answer } = await callPathoAPI(baseUrl, image.dataUrl, question, 'cot')
          return `**图片 ${idx + 1} (${image.name})：**\n${answer}`
        }, '分析')
        return `${results}\n\n**对比总结：** 以上是对 ${images.length} 张病理图像在「${focus}」方面的分别分析，请根据各项特征进行对比判断。`
      },
    },
    {
      name: 'pathology_report',
      description:
        '基于病理图像生成结构化诊断报告，包含诊断结论、关键依据、分级评估和临床建议。当用户要求"出报告""诊断报告""病理报告"时使用。',
      parameters: {
        clinical_info: '可选，补充临床信息，例如"患者女，45岁，乳腺肿块"',
      },
      async execute(args) {
        const images = getImages()
        if (!images.length) return '请先上传病理图像再生成报告。'

        const baseUrl = getApiUrl(apiUrl)
        const clinical = args.clinical_info ? `\n临床信息：${args.clinical_info}` : ''
        const question = `请基于这张病理图像生成一份结构化诊断报告，包含以下部分：
1. **诊断结论**：最可能的病理诊断
2. **关键依据**：支持诊断的形态学特征（至少列出 3 点）
3. **分级/分期评估**：如适用（如 Gleason 评分、WHO 分级、TNM 分期等）
4. **鉴别诊断**：需要排除的其他可能性
5. **临床建议**：进一步检查或随访建议${clinical}`

        try {
          const { answer } = await callPathoAPI(baseUrl, images[0].dataUrl, question, 'cot')
          return `# 病理诊断报告\n\n${answer}`
        } catch (err) {
          return `病理报告生成失败 — ${err instanceof Error ? err.message : err}\n\n${PATHO_HINT}`
        }
      },
    },
  ]
}
