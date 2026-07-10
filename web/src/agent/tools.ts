import type { Tool } from './types'
import { webSearchTool } from './tools/search'
import { evaluateExpression } from './calculator'

export const calculatorTool: Tool = {
  name: 'calculator',
  description: '进行基础数学运算，支持 + - * / 和括号。',
  parameters: { expression: '数学表达式，例如 12 * (3 + 4)' },
  execute(args) {
    const expression = args.expression || ''
    const safe = expression.replace(/[^0-9+\-*/().\s]/g, '')
    if (!safe) return '表达式无效，请提供例如 1 + 2 的算式。'
    try {
      const result = evaluateExpression(safe)
      return `${safe} = ${result}`
    } catch {
      return '计算失败，请检查表达式。'
    }
  },
}

export const datetimeTool: Tool = {
  name: 'datetime',
  description: '返回当前的日期和时间。',
  parameters: { format: '可选，"date"|"time"|"full"，默认 full' },
  execute(args) {
    const now = new Date()
    const format = args.format || 'full'
    if (format === 'date') return now.toLocaleDateString('zh-CN')
    if (format === 'time') return now.toLocaleTimeString('zh-CN')
    return now.toLocaleString('zh-CN')
  },
}

export const builtinTools: Tool[] = [calculatorTool, datetimeTool, webSearchTool]

export { webSearchTool, createWebSearchTool } from './tools/search'
export { createVisionTools } from './tools/visionTools'
export { createPathologyTools } from './tools/pathologyTools'
export { createCellposeTools } from './tools/cellposeTools'
