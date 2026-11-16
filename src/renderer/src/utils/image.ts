export type RotationAngle = 90 | -90

export interface DeskewResult {
  /** 精细校正的倾斜角 */
  angle: number
  /** 为转正文字方向额外执行的 90° 整转（0 / 90 / -90） */
  quarterTurn: number
  changed: boolean
  dataUrl: string
}

export interface DeskewOptions {
  /** 候选图的正立程度打分（分值越大越可信），用于在 ±90° 两个方向中择优 */
  scoreUpright?: (dataUrl: string) => Promise<number>
  /** 旋转后空余区域的填充色（批次底色） */
  bgColor?: string
}

const ANALYSIS_MAX_SIDE = 640
const MAX_SKEW = 15
const COARSE_STEP = 1
const FINE_STEP = 0.1
const REFINE_STEP = 0.02
const MIN_SKEW = 0.5
const MIN_PROMINENCE = 0.15
const RIVAL_WINDOW = 3
/** 整页方向判定：粗扫角度范围与步长 */
const ORIENTATION_STEP = 5
/** 文字行方向偏离水平/垂直轴超过该角度时不做整转 */
const ORIENTATION_TOLERANCE = 15
/** 方向判定时 OCR 使用的预览图最大边长 */
const ORIENTATION_MAX_SIDE = 1200

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })

const PDF_JPEG_QUALITY = 0.92

export function isPdfReadyDataUrl(dataUrl: string): boolean {
  return /^data:image\/(jpeg|png)[;,]/i.test(dataUrl.trim())
}

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const getContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建画布上下文')
  return context
}

interface RgbColor {
  r: number
  g: number
  b: number
}

const WHITE: RgbColor = { r: 255, g: 255, b: 255 }

/** 解析 #RRGGBB，非法值退回白色 */
const parseHexColor = (color?: string): RgbColor => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color?.trim() ?? '')
  if (!match) return WHITE

  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

export async function toPdfJpegDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)

  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效')

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(img, 0, 0)

  return canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY)
}

export interface NormalizedRegion {
  x: number
  y: number
  w: number
  h: number
}

/** 按归一化区域裁剪图像（用于字段框选 OCR） */
export async function cropRegionDataUrl(
  dataUrl: string,
  region: NormalizedRegion
): Promise<string> {
  const img = await loadImage(dataUrl)

  const imageWidth = img.naturalWidth
  const imageHeight = img.naturalHeight
  if (!imageWidth || !imageHeight) throw new Error('图片尺寸无效')

  const sourceX = Math.max(0, Math.round(region.x * imageWidth))
  const sourceY = Math.max(0, Math.round(region.y * imageHeight))
  const width = Math.min(imageWidth - sourceX, Math.max(1, Math.round(region.w * imageWidth)))
  const height = Math.min(imageHeight - sourceY, Math.max(1, Math.round(region.h * imageHeight)))

  if (width <= 0 || height <= 0) throw new Error('框选区域无效')

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(img, sourceX, sourceY, width, height, 0, 0, width, height)

  return canvas.toDataURL('image/png')
}

export async function rotateImage(
  dataUrl: string,
  angle: RotationAngle,
  bgColor = '#ffffff'
): Promise<string> {
  const img = await loadImage(dataUrl)

  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效')

  const swapped = Math.abs(angle) % 180 === 90
  const canvas = createCanvas(swapped ? height : width, swapped ? width : height)
  const context = getContext(canvas)

  context.fillStyle = bgColor
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((angle * Math.PI) / 180)
  context.drawImage(img, -width / 2, -height / 2)

  return canvas.toDataURL('image/png')
}

export type FlipDirection = 'horizontal' | 'vertical'

export async function flipImage(dataUrl: string, direction: FlipDirection): Promise<string> {
  const img = await loadImage(dataUrl)

  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效')

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)

  if (direction === 'horizontal') {
    context.translate(width, 0)
    context.scale(-1, 1)
  } else {
    context.translate(0, height)
    context.scale(1, -1)
  }

  context.drawImage(img, 0, 0, width, height)

  return canvas.toDataURL('image/png')
}

interface SkewAnalysis {
  offsetsX: Float32Array
  offsetsY: Float32Array
  count: number
  width: number
  height: number
  transparent: boolean
}

const otsuThreshold = (histogram: Uint32Array, total: number): number => {
  let sum = 0
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]

  let sumBack = 0
  let weightBack = 0
  let threshold = 0
  let maxVariance = -1

  for (let i = 0; i < 256; i += 1) {
    weightBack += histogram[i]
    if (weightBack === 0) continue

    const weightFore = total - weightBack
    if (weightFore === 0) break

    sumBack += i * histogram[i]
    const meanBack = sumBack / weightBack
    const meanFore = (sum - sumBack) / weightFore
    const variance = weightBack * weightFore * (meanBack - meanFore) * (meanBack - meanFore)

    if (variance > maxVariance) {
      maxVariance = variance
      threshold = i
    }
  }

  return threshold
}

const analyzeSkew = (image: HTMLImageElement): SkewAnalysis => {
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)
  context.drawImage(image, 0, 0, width, height)

  const { data } = context.getImageData(0, 0, width, height)
  const total = width * height
  const gray = new Uint8Array(total)
  const histogram = new Uint32Array(256)
  let transparentPixels = 0
  let opaquePixels = 0

  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    const alpha = data[p + 3]
    if (alpha < 250) transparentPixels += 1
    if (alpha < 32) {
      gray[i] = 255
      continue
    }
    const value = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2])
    gray[i] = value
    histogram[value] += 1
    opaquePixels += 1
  }

  const threshold = otsuThreshold(histogram, opaquePixels)
  const mask = new Uint8Array(total)
  let inkPixels = 0

  for (let i = 0; i < total; i += 1) {
    if (gray[i] === 255 && data[i * 4 + 3] < 32) continue
    const ink = gray[i] <= threshold ? 1 : 0
    mask[i] = ink
    inkPixels += ink
  }

  const inkRatio = opaquePixels ? inkPixels / opaquePixels : 0
  if (inkRatio > 0.6) {
    for (let i = 0; i < total; i += 1) mask[i] = 1 - mask[i]
  } else if (inkRatio < 0.01) {
    let gradientSum = 0
    const gradient = new Float32Array(total)

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x
        const dx = Math.abs(gray[index + 1] - gray[index - 1])
        const dy = Math.abs(gray[index + width] - gray[index - width])
        const magnitude = dx + dy
        gradient[index] = magnitude
        gradientSum += magnitude
      }
    }

    const gradientMean = gradientSum / Math.max(1, (width - 2) * (height - 2))
    const edgeThreshold = Math.max(8, gradientMean * 1.4)

    for (let i = 0; i < total; i += 1) mask[i] = gradient[i] > edgeThreshold ? 1 : 0
  }

  const centerX = width / 2
  const centerY = height / 2
  let count = 0
  for (let i = 0; i < total; i += 1) if (mask[i]) count += 1

  const offsetsX = new Float32Array(count)
  const offsetsY = new Float32Array(count)
  let cursor = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue
      offsetsX[cursor] = x - centerX
      offsetsY[cursor] = y - centerY
      cursor += 1
    }
  }

  return {
    offsetsX,
    offsetsY,
    count,
    width,
    height,
    transparent: opaquePixels > 0 && transparentPixels / total > 0.01
  }
}

const projectionProfile = (
  analysis: SkewAnalysis,
  angleDeg: number
): { bins: Float64Array; used: number } | null => {
  const { offsetsX, offsetsY, count, width, height } = analysis
  if (!count) return null

  const radians = (angleDeg * Math.PI) / 180
  const sin = Math.sin(radians)
  const cos = Math.cos(radians)
  // 投影范围随角度变化，接近 90° 时需按宽度取足够多的分桶
  const span = Math.ceil(width * Math.abs(sin) + height * Math.abs(cos)) + 1
  const center = span / 2

  const bins = new Float64Array(span)
  let used = 0

  for (let i = 0; i < count; i += 1) {
    const projected = offsetsX[i] * sin + offsetsY[i] * cos
    const bin = Math.round(projected + center)
    if (bin < 0 || bin >= span) continue
    bins[bin] += 1
    used += 1
  }

  return used ? { bins, used } : null
}

const projectionScore = (analysis: SkewAnalysis, angleDeg: number): number => {
  const profile = projectionProfile(analysis, angleDeg)
  if (!profile) return 0

  let sum = 0
  for (let i = 0; i < profile.bins.length; i += 1) sum += profile.bins[i] * profile.bins[i]

  return sum / (profile.used * profile.used)
}

/** 归一化投影集中度：墨迹均匀分布时约为 1，文字行方向越明显值越大 */
const normalizedProjectionScore = (analysis: SkewAnalysis, angleDeg: number): number => {
  const profile = projectionProfile(analysis, angleDeg)
  if (!profile) return 0

  let sum = 0
  for (let i = 0; i < profile.bins.length; i += 1) sum += profile.bins[i] * profile.bins[i]

  return (sum / (profile.used * profile.used)) * profile.bins.length
}

const searchAngle = (
  analysis: SkewAnalysis,
  center: number,
  span: number,
  step: number
): { angle: number; score: number } => {
  let bestAngle = center
  let bestScore = -1

  const start = center - span
  const steps = Math.round((span * 2) / step)

  for (let i = 0; i <= steps; i += 1) {
    const angle = start + i * step
    if (Math.abs(angle) > MAX_SKEW) continue
    const score = projectionScore(analysis, angle)
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }

  return { angle: bestAngle, score: bestScore }
}

const refineAngle = (analysis: SkewAnalysis, coarse: { angle: number; score: number }): number => {
  const fine = searchAngle(analysis, coarse.angle, COARSE_STEP, FINE_STEP)
  const refined = searchAngle(analysis, fine.angle, FINE_STEP, REFINE_STEP)

  const before = projectionScore(analysis, refined.angle - REFINE_STEP)
  const after = projectionScore(analysis, refined.angle + REFINE_STEP)
  const denominator = before - 2 * refined.score + after

  let delta = 0
  if (Math.abs(denominator) > 1e-12) {
    delta = (REFINE_STEP * (before - after)) / (2 * denominator)
    delta = Math.max(-REFINE_STEP / 2, Math.min(REFINE_STEP / 2, delta))
  }

  return refined.angle + delta
}

const rivalScore = (analysis: SkewAnalysis, angle: number): number => {
  let rival = 0

  for (let candidate = -MAX_SKEW; candidate <= MAX_SKEW; candidate += COARSE_STEP) {
    if (Math.abs(candidate - angle) < RIVAL_WINDOW) continue
    const score = projectionScore(analysis, candidate)
    if (score > rival) rival = score
  }

  return rival
}

const detectSkewAngle = (analysis: SkewAnalysis): number => {
  if (!analysis.count) return 0

  const coarse = searchAngle(analysis, 0, MAX_SKEW, COARSE_STEP)
  if (coarse.score <= 0) return 0

  const rival = rivalScore(analysis, coarse.angle)
  if ((coarse.score - rival) / coarse.score < MIN_PROMINENCE) return 0

  const angle = refineAngle(analysis, coarse)
  if (!Number.isFinite(angle)) return 0

  return Math.max(-MAX_SKEW, Math.min(MAX_SKEW, angle))
}

const rotateByAngle = (
  image: HTMLImageElement,
  angleDeg: number,
  transparent: boolean,
  bgColor = '#ffffff'
): string => {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效')

  const radians = (angleDeg * Math.PI) / 180

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  if (!transparent) {
    context.fillStyle = bgColor
    context.fillRect(0, 0, width, height)
  }

  context.translate(width / 2, height / 2)
  context.rotate(radians)
  context.drawImage(image, -width / 2, -height / 2, width, height)

  return canvas.toDataURL('image/png')
}

// 粗扫 -90°~90°，判断文字行是横向（0° 附近）还是纵向（±90° 附近）
const detectTextLayout = (analysis: SkewAnalysis): 'horizontal' | 'vertical' | 'unknown' => {
  if (analysis.count < 200) return 'unknown'

  let bestAngle = 0
  let bestScore = -1
  const scores: number[] = []

  for (let angle = -90; angle <= 90; angle += ORIENTATION_STEP) {
    const score = normalizedProjectionScore(analysis, angle)
    scores.push(score)
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }

  // 投影没有明显主方向（如照片、空白页）时不做整页旋转
  scores.sort((a, b) => a - b)
  const median = scores[Math.floor(scores.length / 2)]
  if (bestScore < 1.5 || bestScore < median * 1.15) return 'unknown'

  if (Math.abs(bestAngle) <= ORIENTATION_TOLERANCE) return 'horizontal'
  if (Math.abs(Math.abs(bestAngle) - 90) <= ORIENTATION_TOLERANCE) return 'vertical'
  return 'unknown'
}

const createScaledDataUrl = (image: HTMLImageElement): string => {
  const scale = Math.min(
    1,
    ORIENTATION_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight)
  )
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  // JPEG 无透明通道，先铺白底避免透明区域变黑影响 OCR
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  return canvas.toDataURL('image/jpeg', 0.85)
}

// 顺时针与逆时针整转都能让文字行恢复水平，需借助 OCR 置信度判断哪个方向才是正立
const chooseQuarterTurn = async (
  image: HTMLImageElement,
  scoreUpright?: (dataUrl: string) => Promise<number>
): Promise<RotationAngle> => {
  if (!scoreUpright) return 90

  try {
    const preview = createScaledDataUrl(image)
    const [clockwise, counterClockwise] = await Promise.all([
      rotateImage(preview, 90),
      rotateImage(preview, -90)
    ])
    const [clockwiseScore, counterClockwiseScore] = await Promise.all([
      scoreUpright(clockwise),
      scoreUpright(counterClockwise)
    ])

    return counterClockwiseScore > clockwiseScore ? -90 : 90
  } catch (error) {
    console.error('Failed to decide quarter turn:', error)
    return 90
  }
}

export async function deskewImage(
  dataUrl: string,
  options: DeskewOptions = {}
): Promise<DeskewResult> {
  let image = await loadImage(dataUrl)
  let analysis = analyzeSkew(image)
  let baseDataUrl = dataUrl
  let quarterTurn: RotationAngle | 0 = 0

  // 先处理 ±90° 整页旋转：转正文字行方向后再做精细校正
  if (detectTextLayout(analysis) === 'vertical') {
    quarterTurn = await chooseQuarterTurn(image, options.scoreUpright)
    baseDataUrl = await rotateImage(dataUrl, quarterTurn, options.bgColor)
    image = await loadImage(baseDataUrl)
    analysis = analyzeSkew(image)
  }

  const angle = detectSkewAngle(analysis)

  if (!quarterTurn && Math.abs(angle) < MIN_SKEW) {
    return { angle, quarterTurn: 0, changed: false, dataUrl }
  }

  return {
    angle,
    quarterTurn,
    changed: true,
    dataUrl:
      Math.abs(angle) < MIN_SKEW
        ? baseDataUrl
        : rotateByAngle(image, angle, analysis.transparent, options.bgColor)
  }
}

const MIN_MANUAL_SKEW = 0.01

const hasTransparency = (image: HTMLImageElement): boolean => {
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)
  context.drawImage(image, 0, 0, width, height)

  const { data } = context.getImageData(0, 0, width, height)
  let transparent = 0

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) transparent += 1
  }

  return transparent / (width * height) > 0.01
}

export async function deskewImageByLineAngle(
  dataUrl: string,
  lineAngle: number,
  bgColor = '#ffffff'
): Promise<DeskewResult> {
  const image = await loadImage(dataUrl)
  const angle = -lineAngle

  if (!Number.isFinite(angle) || Math.abs(angle) < MIN_MANUAL_SKEW) {
    return { angle, quarterTurn: 0, changed: false, dataUrl }
  }

  return {
    angle,
    quarterTurn: 0,
    changed: true,
    dataUrl: rotateByAngle(image, angle, hasTransparency(image), bgColor)
  }
}

export interface SampledColor {
  r: number
  g: number
  b: number
  a: number
}

export interface PixelSampler {
  width: number
  height: number
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  imageData: ImageData
}

export interface ColorRemovalResult {
  dataUrl: string
  changed: number
}

const VINTAGE_STRENGTH = 0.85

export async function grayscaleImage(dataUrl: string): Promise<string> {
  const sampler = await createPixelSampler(dataUrl)
  const { data } = sampler.imageData

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
  }

  sampler.context.putImageData(sampler.imageData, 0, 0)

  return sampler.canvas.toDataURL('image/png')
}

export async function vintageImage(dataUrl: string): Promise<string> {
  const sampler = await createPixelSampler(dataUrl)
  const { data } = sampler.imageData
  const keep = 1 - VINTAGE_STRENGTH

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const sepiaR = 0.393 * r + 0.769 * g + 0.189 * b
    const sepiaG = 0.349 * r + 0.686 * g + 0.168 * b
    const sepiaB = 0.272 * r + 0.534 * g + 0.131 * b

    data[i] = Math.min(255, Math.round(r * keep + sepiaR * VINTAGE_STRENGTH))
    data[i + 1] = Math.min(255, Math.round(g * keep + sepiaG * VINTAGE_STRENGTH))
    data[i + 2] = Math.min(255, Math.round(b * keep + sepiaB * VINTAGE_STRENGTH))
  }

  sampler.context.putImageData(sampler.imageData, 0, 0)

  return sampler.canvas.toDataURL('image/png')
}

const SHARPEN_AMOUNT = 0.9
const TEXT_DARK_THRESHOLD = 160
const TEXT_DARK_FACTOR = 0.7

const gaussianBlur = (input: Uint8ClampedArray, width: number, height: number): Float32Array => {
  const output = new Float32Array(width * height)
  const weights = [1, 2, 1]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      let wsum = 0
      for (let ky = -1; ky <= 1; ky += 1) {
        const ny = y + ky
        if (ny < 0 || ny >= height) continue
        for (let kx = -1; kx <= 1; kx += 1) {
          const nx = x + kx
          if (nx < 0 || nx >= width) continue
          const idx = (ny * width + nx) * 4
          const gray = 0.299 * input[idx] + 0.587 * input[idx + 1] + 0.114 * input[idx + 2]
          const w = weights[ky + 1] * weights[kx + 1]
          sum += gray * w
          wsum += w
        }
      }
      output[y * width + x] = sum / wsum
    }
  }

  return output
}

export async function sharpenImage(dataUrl: string): Promise<string> {
  const sampler = await createPixelSampler(dataUrl)
  const { data, width, height } = sampler.imageData

  const blurred = gaussianBlur(data, width, height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      if (data[idx + 3] === 0) continue

      const origGray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
      const blurredGray = blurred[y * width + x]

      let sharpened = origGray + SHARPEN_AMOUNT * (origGray - blurredGray)

      if (origGray < TEXT_DARK_THRESHOLD) {
        sharpened = sharpened * TEXT_DARK_FACTOR
      }

      const result = Math.max(0, Math.min(255, Math.round(sharpened)))
      const factor = result / Math.max(1, origGray)

      data[idx] = Math.min(255, Math.round(data[idx] * factor))
      data[idx + 1] = Math.min(255, Math.round(data[idx + 1] * factor))
      data[idx + 2] = Math.min(255, Math.round(data[idx + 2] * factor))
    }
  }

  sampler.context.putImageData(sampler.imageData, 0, 0)

  return sampler.canvas.toDataURL('image/png')
}

export async function createPixelSampler(dataUrl: string): Promise<PixelSampler> {
  const image = await loadImage(dataUrl)

  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效')

  const canvas = createCanvas(width, height)
  const context = getContext(canvas)
  context.drawImage(image, 0, 0, width, height)

  return {
    width,
    height,
    canvas,
    context,
    imageData: context.getImageData(0, 0, width, height)
  }
}

export function samplePixel(sampler: PixelSampler, x: number, y: number): SampledColor | null {
  if (x < 0 || y < 0 || x >= sampler.width || y >= sampler.height) return null

  const index = (y * sampler.width + x) * 4
  const { data } = sampler.imageData

  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3]
  }
}

export function removeSimilarColor(
  sampler: PixelSampler,
  target: SampledColor,
  tolerance: number,
  bgColor = '#ffffff'
): ColorRemovalResult {
  const { data } = sampler.imageData
  const limit = tolerance * tolerance
  const fill = parseHexColor(bgColor)
  let changed = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    const dr = data[i] - target.r
    const dg = data[i + 1] - target.g
    const db = data[i + 2] - target.b

    if (dr * dr + dg * dg + db * db > limit) continue

    data[i] = fill.r
    data[i + 1] = fill.g
    data[i + 2] = fill.b
    changed += 1
  }

  sampler.context.putImageData(sampler.imageData, 0, 0)

  return { dataUrl: sampler.canvas.toDataURL('image/png'), changed }
}

export interface RegionRect {
  x: number
  y: number
  w: number
  h: number
}

export type RegionMode = 'remove' | 'keep'

const blankRange = (
  data: Uint8ClampedArray,
  width: number,
  row: number,
  from: number,
  to: number,
  fill: RgbColor
): number => {
  let changed = 0

  for (let x = from; x < to; x += 1) {
    const index = (row * width + x) * 4
    if (
      data[index] === fill.r &&
      data[index + 1] === fill.g &&
      data[index + 2] === fill.b &&
      data[index + 3] === 255
    ) {
      continue
    }

    data[index] = fill.r
    data[index + 1] = fill.g
    data[index + 2] = fill.b
    data[index + 3] = 255
    changed += 1
  }

  return changed
}

export async function maskRegion(
  dataUrl: string,
  rect: RegionRect,
  mode: RegionMode,
  bgColor = '#ffffff'
): Promise<ColorRemovalResult> {
  const sampler = await createPixelSampler(dataUrl)
  const { width, height, imageData, context, canvas } = sampler
  const { data } = imageData
  const fill = parseHexColor(bgColor)

  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)))
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)))
  const right = Math.max(left + 1, Math.min(width, Math.round((rect.x + rect.w) * width)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round((rect.y + rect.h) * height)))

  let changed = 0

  for (let row = 0; row < height; row += 1) {
    const insideRow = row >= top && row < bottom

    if (mode === 'remove') {
      if (insideRow) changed += blankRange(data, width, row, left, right, fill)
      continue
    }

    if (!insideRow) {
      changed += blankRange(data, width, row, 0, width, fill)
      continue
    }

    changed += blankRange(data, width, row, 0, left, fill)
    changed += blankRange(data, width, row, right, width, fill)
  }

  context.putImageData(imageData, 0, 0)

  return { dataUrl: canvas.toDataURL('image/png'), changed }
}

export interface CenterRegionResult extends ColorRemovalResult {
  offsetX: number
  offsetY: number
}

export async function centerRegion(
  dataUrl: string,
  rect: RegionRect,
  bgColor = '#ffffff'
): Promise<CenterRegionResult> {
  const sampler = await createPixelSampler(dataUrl)
  const { width, height, imageData, context, canvas } = sampler
  const { data } = imageData
  const fill = parseHexColor(bgColor)

  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)))
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)))
  const right = Math.max(left + 1, Math.min(width, Math.round((rect.x + rect.w) * width)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round((rect.y + rect.h) * height)))

  const regionWidth = right - left
  const regionHeight = bottom - top

  const patch = new Uint8ClampedArray(regionWidth * regionHeight * 4)
  for (let row = 0; row < regionHeight; row += 1) {
    const from = ((top + row) * width + left) * 4
    patch.set(data.subarray(from, from + regionWidth * 4), row * regionWidth * 4)
  }

  const targetLeft = Math.round((width - regionWidth) / 2)
  const targetTop = Math.round((height - regionHeight) / 2)

  const output = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < output.length; i += 4) {
    output[i] = fill.r
    output[i + 1] = fill.g
    output[i + 2] = fill.b
    output[i + 3] = 255
  }

  for (let row = 0; row < regionHeight; row += 1) {
    const to = ((targetTop + row) * width + targetLeft) * 4
    output.set(patch.subarray(row * regionWidth * 4, (row + 1) * regionWidth * 4), to)
  }

  let changed = 0
  for (let i = 0; i < data.length; i += 4) {
    if (
      data[i] !== output[i] ||
      data[i + 1] !== output[i + 1] ||
      data[i + 2] !== output[i + 2] ||
      data[i + 3] !== output[i + 3]
    ) {
      changed += 1
    }
  }

  data.set(output)
  context.putImageData(imageData, 0, 0)

  return {
    dataUrl: canvas.toDataURL('image/png'),
    changed,
    offsetX: targetLeft - left,
    offsetY: targetTop - top
  }
}