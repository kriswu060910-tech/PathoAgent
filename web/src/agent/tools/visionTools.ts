import type { AnnotationBox, Tool } from '../types'
import { analyzeImages, detectObjectsWithEdges, type ImageAttachment } from '../vision'
import { NO_IMAGE_MSG, type GetImages } from './shared'

type OnAnnotate = (boxes: AnnotationBox[]) => void

function buildPrefix(images: ImageAttachment[]): string {
  return images.length > 1 ? `共 ${images.length} 张图片：\n` : ''
}

function createImageAnalysisTool(
  getImages: GetImages,
  name: string,
  description: string,
  parameters: Record<string, string>,
  buildPrompt: (args: Record<string, string>) => string,
): Tool {
  return {
    name,
    description,
    parameters,
    async execute(args) {
      const images = getImages()
      if (!images.length) return NO_IMAGE_MSG
      return buildPrefix(images) + await analyzeImages(images, buildPrompt(args))
    },
  }
}

export function createVisionTools(getImages: GetImages, onAnnotate?: OnAnnotate): Tool[] {
  return [
    createImageAnalysisTool(
      getImages,
      'extract_text',
      '提取图片中的文字内容（OCR）。当用户问"图中写了什么""提取文字"时使用。',
      { language: '可选，期望的语言，例如"中文""英文"，默认自动识别' },
      (args) => args.language
        ? `请提取图片中所有${args.language}文字，保持原始排版和层级结构。如有表格请用 markdown 表格格式输出。`
        : '请提取图片中所有文字内容，保持原始排版和层级结构。如有表格请用 markdown 表格格式输出。',
    ),
    {
      name: 'annotate_objects',
      description: '在图片上标注检测到的物体，沿物体边缘绘制精确的多边形轮廓（使用 Canny 边缘检测 + 区域分割算法）。当用户要求"标注""框出""画出物体位置""抠图""勾边"时使用。',
      parameters: {},
      async execute() {
        const images = getImages()
        if (!images.length) return NO_IMAGE_MSG

        const allBoxes: AnnotationBox[] = []
        for (const image of images) {
          const boxes = await detectObjectsWithEdges(image)
          allBoxes.push(...boxes)
        }

        if (allBoxes.length === 0) return '未能检测到物体位置，无法生成标注。'
        onAnnotate?.(allBoxes)
        const labels = allBoxes.map((b) => b.label).join('、')
        const prefix = images.length > 1 ? `（共 ${images.length} 张图片）` : ''
        return `${prefix}已在图片上沿边缘标注 ${allBoxes.length} 个物体：${labels}。多边形轮廓已通过边缘检测算法精确绘制在用户界面中。`
      },
    },
  ]
}
