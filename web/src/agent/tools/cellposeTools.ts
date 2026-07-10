import type { Tool } from '../types'
import { apiPost, processImages, imagePrefix, parseOptionalFloat } from './shared'
import type { GetImages } from './shared'

function getApiUrl(envUrl?: string): string {
  return envUrl || import.meta.env.VITE_CELLPOSE_API_URL || '/api/cellpose'
}

interface CellInfo {
  id: number
  area_pixels: number
  area_um2: number | null
  centroid: number[]
  bbox: number[]
}

interface CellMeasurement extends CellInfo {
  perimeter_pixels: number
  circularity: number
  eccentricity: number
  major_axis: number
  minor_axis: number
  orientation: number
}

interface SegmentResponse {
  cell_count: number
  cells: CellInfo[]
  overlay_image: string
  mask_image: string
}

interface MeasureResponse {
  cell_count: number
  cells: CellMeasurement[]
  summary: Record<string, number>
  overlay_image: string
}

function areaDisplay(c: { area_um2: number | null; area_pixels: number }): string {
  return c.area_um2 ? `${c.area_um2} μm²` : `${c.area_pixels} px`
}

function formatCellTable(cells: CellInfo[]): string {
  if (!cells.length) return '未检测到细胞。'
  const unit = cells[0]?.area_um2 ? '面积' : '面积(px)'
  const rows = cells.slice(0, 50).map((c) =>
    `| ${c.id} | ${areaDisplay(c)} | (${c.centroid[0].toFixed(0)}, ${c.centroid[1].toFixed(0)}) |`,
  )
  return `| # | ${unit} | 质心 |\n|---|--------|------|\n${rows.join('\n')}`
}

function formatMeasureTable(cells: CellMeasurement[]): string {
  if (!cells.length) return '未检测到细胞。'
  const unit = cells[0]?.area_um2 ? '面积' : '面积(px)'
  const rows = cells.slice(0, 50).map((c) =>
    `| ${c.id} | ${areaDisplay(c)} | ${c.circularity} | ${c.major_axis.toFixed(1)}×${c.minor_axis.toFixed(1)} | ${c.orientation.toFixed(0)}° |`,
  )
  return `| # | ${unit} | 圆度 | 长×短轴 | 方向 |\n|---|--------|------|---------|------|\n${rows.join('\n')}`
}

export function createCellposeTools(getImages: GetImages, apiUrl?: string): Tool[] {
  const baseUrl = getApiUrl(apiUrl)
  return [
    {
      name: 'cell_segment',
      description:
        '使用 Cellpose 对图像中的细胞进行自动分割和计数。适用于组织切片、细胞培养、荧光显微镜等图像。返回细胞数量、每个细胞的面积和位置，以及标注叠加图。当用户要求"数细胞""细胞计数""细胞分割""有多少个细胞"时使用。',
      parameters: {
        diameter: '可选，预期细胞直径（像素），留空则自动估计。例如 "30"',
      },
      async execute(args) {
        const images = getImages()
        if (!images.length) return '请先上传图像再进行细胞分割。'
        const diameter = parseOptionalFloat(args.diameter)

        return processImages(images, async (image, idx) => {
          const data = await apiPost<SegmentResponse>(`${baseUrl}/segment`, {
            image: image.dataUrl, diameter: diameter ?? null,
          })
          const prefix = imagePrefix(images.length, idx, image.name)
          let text = `${prefix}**检测到 ${data.cell_count} 个细胞**\n\n${formatCellTable(data.cells)}`
          if (data.cells.length > 50) text += `\n\n（仅显示前 50 个细胞，共 ${data.cell_count} 个）`
          text += `\n\n![细胞分割标注](${data.overlay_image})`
          return text
        }, '细胞分割')
      },
    },
    {
      name: 'cell_measure',
      description:
        '对图像中的细胞进行详细形态学测量，包括面积、周长、圆度、离心率、长轴/短轴和方向角。当用户要求"测量细胞""细胞大小""细胞形态""圆度分析"时使用。',
      parameters: {
        pixel_size: '可选，每像素对应的微米数，用于换算实际尺寸。例如 "0.5" 表示每像素 0.5μm',
        diameter: '可选，预期细胞直径（像素），留空则自动估计',
      },
      async execute(args) {
        const images = getImages()
        if (!images.length) return '请先上传图像再进行测量。'
        const pixelSize = parseOptionalFloat(args.pixel_size)
        const diameter = parseOptionalFloat(args.diameter)

        return processImages(images, async (image, idx) => {
          const data = await apiPost<MeasureResponse>(`${baseUrl}/measure`, {
            image: image.dataUrl, diameter: diameter ?? null, pixel_size: pixelSize ?? null,
          })
          const prefix = imagePrefix(images.length, idx, image.name)
          const s = data.summary
          const areaLine = pixelSize
            ? `- 平均面积：${s.mean_area_um2} μm²\n- 中位面积：${s.median_area_um2} μm²`
            : `- 平均面积：${s.mean_area_px} px\n- 中位面积：${s.median_area_px} px`
          let text = `${prefix}**测量结果：${data.cell_count} 个细胞**\n\n`
            + `**统计摘要：**\n- 细胞总数：${s.total_cells}\n${areaLine}\n`
            + `- 平均圆度：${s.mean_circularity}（1.0 = 完美圆形）\n\n`
            + formatMeasureTable(data.cells)
          if (data.cells.length > 50) text += `\n\n（仅显示前 50 个细胞，共 ${data.cell_count} 个）`
          text += `\n\n![形态学标注](${data.overlay_image})`
          return text
        }, '形态学测量')
      },
    },
  ]
}
