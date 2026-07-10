import type { AnnotationBox } from '../types/agent'

interface BoundingBoxOverlayProps {
  boxes: AnnotationBox[]
}

const COLORS = [
  '#818cf8', '#f472b6', '#34d399', '#fbbf24',
  '#60a5fa', '#f87171', '#a78bfa', '#2dd4bf',
]

function polygonPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function labelPosition(box: AnnotationBox): { x: number; y: number } {
  if (box.points && box.points.length > 0) {
    const minY = Math.min(...box.points.map((p) => p.y))
    const minX = Math.min(...box.points.map((p) => p.x))
    return { x: minX, y: minY }
  }
  return { x: box.x, y: box.y }
}

/** 估算标签宽度：中文字符约占 2 个英文字符宽度 */
function estimateLabelWidth(label: string): number {
  let units = 0
  for (const ch of label) {
    units += ch.charCodeAt(0) > 127 ? 2 : 1
  }
  return Math.max(0.06, units * 0.014)
}

export function BoundingBoxOverlay({ boxes }: BoundingBoxOverlayProps) {
  return (
    <svg
      className="bbox-overlay"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      {boxes.map((box, i) => {
        const color = COLORS[i % COLORS.length]
        const hasPolygon = box.points && box.points.length >= 3
        const pos = labelPosition(box)
        const labelH = 0.045
        const labelW = estimateLabelWidth(box.label)
        // 防止标签超出 SVG 顶部
        const labelY = pos.y < labelH + 0.01 ? pos.y + 0.005 : pos.y - labelH

        return (
          <g key={i}>
            {hasPolygon ? (
              <polygon
                points={polygonPoints(box.points!)}
                fill={color}
                fillOpacity="0.1"
                stroke={color}
                strokeWidth="0.006"
                strokeLinejoin="round"
              />
            ) : (
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                fill="none"
                stroke={color}
                strokeWidth="0.006"
                rx="0.004"
              />
            )}
            <rect
              x={pos.x}
              y={labelY}
              width={labelW}
              height={labelH}
              fill={color}
              rx="0.004"
            />
            <text
              x={pos.x + 0.008}
              y={labelY + labelH * 0.7}
              fill="#fff"
              fontSize="0.028"
              fontFamily="system-ui, sans-serif"
            >
              {box.label}
              {box.confidence ? ` ${Math.round(box.confidence * 100)}%` : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
