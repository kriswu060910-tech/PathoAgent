/**
 * 客户端图像处理：区域分割 + 边缘检测 + 轮廓提取。
 *
 * 核心思路：在 LLM 给出的每个检测框内独立做分割，
 * 结合 Canny 边缘（作为屏障）和颜色概率图（前景/背景直方图）
 * 通过 BFS 填充获取精确的物体蒙版，再提取轮廓多边形。
 *
 * 输出归一化坐标 (0-1) 的多边形轮廓，供标注系统使用。
 */

export interface Point {
  x: number
  y: number
}

export interface EdgeContour {
  points: Point[]
  bbox: { x: number; y: number; width: number; height: number }
  area: number
}

/* ------------------------------------------------------------------ */
/*  常量                                                               */
/* ------------------------------------------------------------------ */

const MAX_PROCESS_DIM = 500
const DP_EPSILON = 2.5
const BILATERAL_RADIUS = 3
const BILATERAL_SIGMA_S = 3.0
const BILATERAL_SIGMA_I = 25.0
const EDGE_DILATE_RADIUS = 1
const MIN_COMPONENT_PX = 30

/* ------------------------------------------------------------------ */
/*  图像加载                                                           */
/* ------------------------------------------------------------------ */

async function loadImageCanvas(
  dataUrl: string,
): Promise<{ ctx: CanvasRenderingContext2D; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve({ ctx, w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/* ------------------------------------------------------------------ */
/*  Canny 管线各阶段                                                    */
/* ------------------------------------------------------------------ */

function rgbToGray(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114
}

function toGrayscale(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8ClampedArray {
  const { data } = ctx.getImageData(0, 0, w, h)
  const gray = new Uint8ClampedArray(w * h)
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4
    gray[i] = rgbToGray(data[j], data[j + 1], data[j + 2])
  }
  return gray
}

function getRgbData(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8ClampedArray {
  return ctx.getImageData(0, 0, w, h).data
}

function scaleDown(
  src: Uint8ClampedArray, srcW: number, srcH: number,
  dstW: number, dstH: number, channels: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstW * dstH * channels)
  const rx = srcW / dstW
  const ry = srcH / dstH
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor(x * rx), srcW - 1)
      const sy = Math.min(Math.floor(y * ry), srcH - 1)
      for (let c = 0; c < channels; c++) {
        dst[(y * dstW + x) * channels + c] = src[(sy * srcW + sx) * channels + c]
      }
    }
  }
  return dst
}

/** 双边滤波器 — 保边去纹理，消除面部/头发内部边缘 */
function bilateralFilter(gray: Uint8ClampedArray, w: number, h: number): Float64Array {
  const r = BILATERAL_RADIUS
  const sigmaS2 = 2 * BILATERAL_SIGMA_S * BILATERAL_SIGMA_S
  const sigmaI2 = 2 * BILATERAL_SIGMA_I * BILATERAL_SIGMA_I
  const spatialW = new Float64Array((2 * r + 1) * (2 * r + 1))
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      spatialW[(dy + r) * (2 * r + 1) + (dx + r)] = Math.exp(-(dx * dx + dy * dy) / sigmaS2)
    }
  }
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let wSum = 0, val = 0
      const c = gray[y * w + x]
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.min(Math.max(y + dy, 0), h - 1)
        for (let dx = -r; dx <= r; dx++) {
          const nx = Math.min(Math.max(x + dx, 0), w - 1)
          const d = gray[ny * w + nx] - c
          const weight = spatialW[(dy + r) * (2 * r + 1) + (dx + r)] * Math.exp(-(d * d) / sigmaI2)
          val += weight * gray[ny * w + nx]
          wSum += weight
        }
      }
      out[y * w + x] = val / wSum
    }
  }
  return out
}

function sobelGradient(
  img: Float64Array, w: number, h: number,
): { mag: Float64Array; dir: Float64Array } {
  const mag = new Float64Array(w * h)
  const dir = new Float64Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = img[(y - 1) * w + (x - 1)], t = img[(y - 1) * w + x], tr = img[(y - 1) * w + (x + 1)]
      const l = img[y * w + (x - 1)], r = img[y * w + (x + 1)]
      const bl = img[(y + 1) * w + (x - 1)], b = img[(y + 1) * w + x], br = img[(y + 1) * w + (x + 1)]
      const gx = -tl + tr - 2 * l + 2 * r - bl + br
      const gy = -tl - 2 * t - tr + bl + 2 * b + br
      const i = y * w + x
      mag[i] = Math.sqrt(gx * gx + gy * gy)
      dir[i] = Math.atan2(gy, gx)
    }
  }
  return { mag, dir }
}

function nonMaxSuppression(mag: Float64Array, dir: Float64Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      let angle = (dir[i] * 180) / Math.PI
      if (angle < 0) angle += 180
      let n1 = 0, n2 = 0
      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        n1 = mag[i - 1]; n2 = mag[i + 1]
      } else if (angle >= 22.5 && angle < 67.5) {
        n1 = mag[(y + 1) * w + (x - 1)]; n2 = mag[(y - 1) * w + (x + 1)]
      } else if (angle >= 67.5 && angle < 112.5) {
        n1 = mag[(y - 1) * w + x]; n2 = mag[(y + 1) * w + x]
      } else {
        n1 = mag[(y - 1) * w + (x - 1)]; n2 = mag[(y + 1) * w + (x + 1)]
      }
      out[i] = (mag[i] >= n1 && mag[i] >= n2) ? mag[i] : 0
    }
  }
  return out
}

function hysteresis(nms: Float64Array, w: number, h: number, lowR = 0.06, highR = 0.18): Uint8Array {
  let maxVal = 0
  for (let i = 0; i < nms.length; i++) if (nms[i] > maxVal) maxVal = nms[i]
  const low = maxVal * lowR, high = maxVal * highR
  const STRONG = 255, WEAK = 128
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) {
    if (nms[i] >= high) out[i] = STRONG
    else if (nms[i] >= low) out[i] = WEAK
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (out[i] !== WEAK) continue
      const connected =
        out[(y - 1) * w + (x - 1)] === STRONG || out[(y - 1) * w + x] === STRONG ||
        out[(y - 1) * w + (x + 1)] === STRONG || out[y * w + (x - 1)] === STRONG ||
        out[y * w + (x + 1)] === STRONG || out[(y + 1) * w + (x - 1)] === STRONG ||
        out[(y + 1) * w + x] === STRONG || out[(y + 1) * w + (x + 1)] === STRONG
      out[i] = connected ? STRONG : 0
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i] !== STRONG) out[i] = 0
  return out
}

function dilate(edges: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) out[ny * w + nx] = 255
        }
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  连通分量 & 凸包                                                     */
/* ------------------------------------------------------------------ */

function connectedComponents(binary: Uint8Array, w: number, h: number, minSize: number): Point[][] {
  const visited = new Uint8Array(w * h)
  const components: Point[][] = []
  const dx = [-1, -1, -1, 0, 0, 1, 1, 1]
  const dy = [-1, 0, 1, -1, 1, -1, 0, 1]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!binary[i] || visited[i]) continue
      const comp: Point[] = []
      const queue = [i]
      visited[i] = 1
      let qi = 0
      while (qi < queue.length) {
        const ci = queue[qi++]
        const cx = ci % w, cy = (ci - cx) / w
        comp.push({ x: cx, y: cy })
        for (let d = 0; d < 8; d++) {
          const nx = cx + dx[d], ny = cy + dy[d]
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const ni = ny * w + nx
          if (binary[ni] && !visited[ni]) { visited[ni] = 1; queue.push(ni) }
        }
      }
      if (comp.length >= minSize) components.push(comp)
    }
  }
  return components
}

function convexHull(pts: Point[]): Point[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 2) return [...sorted]
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) upper.pop()
    upper.push(sorted[i])
  }
  lower.pop(); upper.pop()
  return lower.concat(upper)
}

/* ------------------------------------------------------------------ */
/*  Douglas-Peucker 简化                                                */
/* ------------------------------------------------------------------ */

function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.sqrt(lenSq)
}

function dpSimplify(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return [...pts]
  let maxD = 0, idx = 0
  const a = pts[0], b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b)
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= epsilon) return [a, b]
  const left = dpSimplify(pts.slice(0, idx + 1), epsilon)
  const right = dpSimplify(pts.slice(idx), epsilon)
  return left.slice(0, -1).concat(right)
}

/* ------------------------------------------------------------------ */
/*  通用 BFS 泛洪填充                                                   */
/* ------------------------------------------------------------------ */

const DX4 = [-1, 1, 0, 0]
const DY4 = [0, 0, -1, 1]

/** 从种子像素出发，按 canVisit 条件做 4-连通泛洪填充，返回二值蒙版 */
function floodFill(
  w: number, h: number,
  seeds: number[],
  canVisit: (idx: number) => boolean,
): Uint8Array {
  const size = w * h
  const mask = new Uint8Array(size)
  const visited = new Uint8Array(size)
  const queue = [...seeds]
  for (const s of seeds) visited[s] = 1

  let qi = 0
  while (qi < queue.length) {
    const ci = queue[qi++]
    if (!canVisit(ci)) continue
    mask[ci] = 1
    const px = ci % w, py = (ci - px) / w
    for (let d = 0; d < 4; d++) {
      const nx = px + DX4[d], ny = py + DY4[d]
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const ni = ny * w + nx
      if (!visited[ni]) { visited[ni] = 1; queue.push(ni) }
    }
  }
  return mask
}

/* ------------------------------------------------------------------ */
/*  颜色概率图 + BFS 分割（区域级）                                      */
/* ------------------------------------------------------------------ */

/**
 * 在指定区域内做前景分割：
 *  - 纯色背景 → 魔棒模式：角点取色 + BFS 反色填充，精准抠图
 *  - 复杂背景 → 双边滤波 Canny + 颜色概率图 + BFS 填充
 */
function segmentRegion(
  rgbFull: Uint8ClampedArray,
  fullW: number,
  fullH: number,
  box: { x: number; y: number; width: number; height: number },
): Point[] | null {
  const pad = 0.06
  const x1 = Math.max(0, Math.floor((box.x - pad) * fullW))
  const y1 = Math.max(0, Math.floor((box.y - pad) * fullH))
  const x2 = Math.min(fullW, Math.ceil((box.x + box.width + pad) * fullW))
  const y2 = Math.min(fullH, Math.ceil((box.y + box.height + pad) * fullH))
  const rw = x2 - x1, rh = y2 - y1
  if (rw < 12 || rh < 12) return null

  const size = rw * rh

  // --- 提取区域 RGB + 灰度 ---
  const rgb = new Uint8ClampedArray(size * 3)
  const gray = new Uint8ClampedArray(size)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const fi = ((y1 + y) * fullW + (x1 + x)) * 4
      const ri = y * rw + x
      const r = rgbFull[fi], g = rgbFull[fi + 1], b = rgbFull[fi + 2]
      rgb[ri * 3] = r; rgb[ri * 3 + 1] = g; rgb[ri * 3 + 2] = b
      gray[ri] = rgbToGray(r, g, b)
    }
  }

  // --- 角点采样 → 判断纯色背景 ---
  const corners = [
    [rgb[0], rgb[1], rgb[2]],
    [rgb[(rw - 1) * 3], rgb[(rw - 1) * 3 + 1], rgb[(rw - 1) * 3 + 2]],
    [rgb[(rh - 1) * rw * 3], rgb[(rh - 1) * rw * 3 + 1], rgb[(rh - 1) * rw * 3 + 2]],
    [rgb[(size - 1) * 3], rgb[(size - 1) * 3 + 1], rgb[(size - 1) * 3 + 2]],
  ]
  const cMean = corners.reduce(
    (acc, c) => [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4],
    [0, 0, 0] as number[],
  )
  const cVar = corners.reduce((sum, c) => {
    const dr = c[0] - cMean[0], dg = c[1] - cMean[1], db = c[2] - cMean[2]
    return sum + dr * dr + dg * dg + db * db
  }, 0) / 4
  const isSolidBg = cVar < 900

  // --- 区域内 Canny（双边滤波保边） ---
  const blurred = bilateralFilter(gray, rw, rh)
  const { mag, dir } = sobelGradient(blurred, rw, rh)
  const nms = nonMaxSuppression(mag, dir, rw, rh)
  const rawEdges = hysteresis(nms, rw, rh, 0.05, 0.15)
  const edgeBarrier = dilate(rawEdges, rw, rh, EDGE_DILATE_RADIUS)

  if (isSolidBg) {
    // ==== 魔棒模式：纯色背景 ====
    const tolerance = Math.max(25, Math.sqrt(cVar) * 1.8)

    // 从所有边框像素开始泛洪
    const seeds: number[] = []
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        if (x === 0 || x === rw - 1 || y === 0 || y === rh - 1) {
          seeds.push(y * rw + x)
        }
      }
    }

    const mask = floodFill(rw, rh, seeds, (ci) => {
      const r = rgb[ci * 3], g = rgb[ci * 3 + 1], b = rgb[ci * 3 + 2]
      const dist = Math.sqrt(
        (r - cMean[0]) ** 2 + (g - cMean[1]) ** 2 + (b - cMean[2]) ** 2,
      )
      if (dist > tolerance) return false
      if (edgeBarrier[ci] && dist > tolerance * 0.5) return false
      return true
    })

    // 反色：未标记的 = 前景
    return extractMaskContour(mask, rw, rh, x1, y1, fullW, fullH, true)
  }

  // ==== 复杂背景模式：颜色概率 + BFS ====
  const BINS = 8, BIN = 256 / BINS
  const fgH = new Float64Array(BINS ** 3)
  const bgH = new Float64Array(BINS ** 3)
  let fgN = 0, bgN = 0

  const innerM = 0.18
  const ix1 = Math.floor(rw * innerM), ix2 = Math.floor(rw * (1 - innerM))
  const iy1 = Math.floor(rh * innerM), iy2 = Math.floor(rh * (1 - innerM))
  const borderM = 0.08
  const bx2 = Math.max(2, Math.floor(rw * borderM))
  const by2 = Math.max(2, Math.floor(rh * borderM))

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const ri = y * rw + x
      const r = Math.min(BINS - 1, Math.floor(rgb[ri * 3] / BIN))
      const g = Math.min(BINS - 1, Math.floor(rgb[ri * 3 + 1] / BIN))
      const b = Math.min(BINS - 1, Math.floor(rgb[ri * 3 + 2] / BIN))
      const bi = r * BINS * BINS + g * BINS + b
      if (x >= ix1 && x < ix2 && y >= iy1 && y < iy2) { fgH[bi]++; fgN++ }
      if (x < bx2 || x >= rw - bx2 || y < by2 || y >= rh - by2) { bgH[bi]++; bgN++ }
    }
  }
  if (fgN === 0 || bgN === 0) return null

  const prob = new Float64Array(size)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const ri = y * rw + x
      const r = Math.min(BINS - 1, Math.floor(rgb[ri * 3] / BIN))
      const g = Math.min(BINS - 1, Math.floor(rgb[ri * 3 + 1] / BIN))
      const b = Math.min(BINS - 1, Math.floor(rgb[ri * 3 + 2] / BIN))
      const bi = r * BINS * BINS + g * BINS + b
      const pFg = (fgH[bi] + 0.5) / (fgN + 1)
      const pBg = (bgH[bi] + 0.5) / (bgN + 1)
      prob[ri] = pFg / (pFg + pBg)
    }
  }

  const PROB_THRESHOLD = 0.32
  const cx = Math.floor(rw / 2), cy = Math.floor(rh / 2)
  const mask = floodFill(rw, rh, [cy * rw + cx], (ci) => {
    if (prob[ci] < PROB_THRESHOLD) return false
    if (edgeBarrier[ci] && prob[ci] < 0.55) return false
    return true
  })

  return extractMaskContour(mask, rw, rh, x1, y1, fullW, fullH, false)
}

/** 从二值蒙版提取边界 → 凸包 → 简化 → 归一化多边形 */
function extractMaskContour(
  mask: Uint8Array,
  rw: number, rh: number,
  x1: number, y1: number,
  fullW: number, fullH: number,
  invert: boolean,
): Point[] | null {
  const dx8 = [-1, -1, -1, 0, 0, 1, 1, 1]
  const dy8 = [-1, 0, 1, -1, 1, -1, 0, 1]
  const border: Point[] = []

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const ri = y * rw + x
      const isFg = invert ? !mask[ri] : !!mask[ri]
      if (!isFg) continue
      let onBorder = false
      for (let d = 0; d < 8; d++) {
        const nx = x + dx8[d], ny = y + dy8[d]
        if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) { onBorder = true; break }
        const ni = ny * rw + nx
        const nFg = invert ? !mask[ni] : !!mask[ni]
        if (!nFg) { onBorder = true; break }
      }
      if (onBorder) border.push({ x: x1 + x, y: y1 + y })
    }
  }

  if (border.length < 8) return null
  const hull = convexHull(border)
  const simplified = dpSimplify(hull, DP_EPSILON)
  if (simplified.length < 3) return null

  return simplified.map((p) => ({
    x: Math.max(0, Math.min(1, p.x / fullW)),
    y: Math.max(0, Math.min(1, p.y / fullH)),
  }))
}

/* ------------------------------------------------------------------ */
/*  全局 Canny 轮廓（后备方案）                                          */
/* ------------------------------------------------------------------ */

function extractGlobalContours(
  gray: Uint8ClampedArray, w: number, h: number,
): EdgeContour[] {
  const blurred = bilateralFilter(gray, w, h)
  const { mag, dir } = sobelGradient(blurred, w, h)
  const nms = nonMaxSuppression(mag, dir, w, h)
  const edges = hysteresis(nms, w, h, 0.05, 0.15)
  const closed = dilate(edges, w, h, 2)
  const components = connectedComponents(closed, w, h, MIN_COMPONENT_PX)
  if (!components.length) return []

  const edgeSet = new Set<number>()
  for (let i = 0; i < edges.length; i++) if (edges[i]) edgeSet.add(i)

  const sortedComps = components.sort((a, b) => b.length - a.length).slice(0, 30)
  const contours: EdgeContour[] = []
  const normX = 1 / w, normY = 1 / h

  for (const comp of sortedComps) {
    const edgePts = comp.filter((p) => edgeSet.has(p.y * w + p.x))
    if (edgePts.length < 12) continue
    const hull = convexHull(edgePts)
    const simplified = dpSimplify(hull, DP_EPSILON)
    if (simplified.length < 3) continue
    const normPts = simplified.map((p) => ({ x: p.x * normX, y: p.y * normY }))
    const minX = Math.min(...normPts.map((p) => p.x))
    const minY = Math.min(...normPts.map((p) => p.y))
    const maxX = Math.max(...normPts.map((p) => p.x))
    const maxY = Math.max(...normPts.map((p) => p.y))
    contours.push({
      points: normPts,
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      area: (maxX - minX) * (maxY - minY),
    })
  }
  return contours.filter((c) => c.area > 0.005)
}

/* ------------------------------------------------------------------ */
/*  公共 API                                                           */
/* ------------------------------------------------------------------ */

/**
 * 在 LLM 检测框内做区域分割，返回精确的边缘多边形。
 * 对每个 box 独立处理，返回对应的归一化多边形顶点；
 * 若分割失败则返回 null（调用方可回退到 LLM 原始多边形）。
 */
export async function segmentBoxes(
  dataUrl: string,
  boxes: { x: number; y: number; width: number; height: number }[],
): Promise<(Point[] | null)[]> {
  try {
    const { ctx, w: origW, h: origH } = await loadImageCanvas(dataUrl)

    // 按比例缩放
    const scale = Math.min(1, MAX_PROCESS_DIM / Math.max(origW, origH))
    const procW = Math.round(origW * scale)
    const procH = Math.round(origH * scale)

    let rgb: Uint8ClampedArray
    if (scale < 1) {
      const fullRgb = getRgbData(ctx, origW, origH)
      rgb = scaleDown(fullRgb, origW, origH, procW, procH, 3)
    } else {
      rgb = getRgbData(ctx, procW, procH)
    }

    return boxes.map((box) => segmentRegion(rgb, procW, procH, box))
  } catch (err) {
    console.warn('[edgeDetection] segmentBoxes failed:', err)
    return boxes.map(() => null)
  }
}

/**
 * 全局 Canny 边缘检测提取轮廓（后备方案，当无 LLM 框时使用）。
 */
export async function extractEdgeContours(
  dataUrl: string,
): Promise<{ contours: EdgeContour[]; width: number; height: number } | null> {
  try {
    const { ctx, w: origW, h: origH } = await loadImageCanvas(dataUrl)
    const scale = Math.min(1, MAX_PROCESS_DIM / Math.max(origW, origH))
    const procW = Math.round(origW * scale)
    const procH = Math.round(origH * scale)

    let gray: Uint8ClampedArray
    if (scale < 1) {
      const fullGray = toGrayscale(ctx, origW, origH)
      gray = scaleDown(fullGray, origW, origH, procW, procH, 1)
    } else {
      gray = toGrayscale(ctx, procW, procH)
    }

    const contours = extractGlobalContours(gray, procW, procH)
    return contours.length ? { contours, width: origW, height: origH } : null
  } catch (err) {
    console.warn('[edgeDetection] extractEdgeContours failed:', err)
    return null
  }
}
