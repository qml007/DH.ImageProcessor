export type RotationAngle = 90 | -90

export interface DeskewResult {
  angle: number
  changed: boolean
  dataUrl: string
}

const ANALYSIS_MAX_SIDE = 640
const MAX_SKEW = 15
const COARSE_STEP = 1
const FINE_STEP = 0.1
const REFINE_STEP = 0.02
const MIN_SKEW = 0.5
const MIN_PROMINENCE = 0.15
const RIVAL_WINDOW = 3

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

export async function rotateImage(dataUrl: string, angle: RotationAngle): Promise<string> {
  const img = await loadImage(dataUrl)

  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效')

  const swapped = Math.abs(angle) % 180 === 90
  const canvas = createCanvas(swapped ? height : width, swapped ? width : height)
  const context = getContext(canvas)

  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((angle * Math.PI) / 180)
  context.drawImage(img, -width / 2, -height / 2)

  return canvas.toDataURL('image/png')
}

interface SkewAnalysis {
  offsetsX: Float32Array
  offsetsY: Float32Array
  count: number
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
    height,
    transparent: opaquePixels > 0 && transparentPixels / total > 0.01
  }
}

const projectionScore = (analysis: SkewAnalysis, angleDeg: number): number => {
  const { offsetsX, offsetsY, count, height } = analysis
  if (!count) return 0

  const radians = (angleDeg * Math.PI) / 180
  const sin = Math.sin(radians)
  const cos = Math.cos(radians)
  const center = height / 2

  const bins = new Float64Array(height)
  let used = 0

  for (let i = 0; i < count; i += 1) {
    const projected = offsetsX[i] * sin + offsetsY[i] * cos
    const bin = Math.round(projected + center)
    if (bin < 0 || bin >= height) continue
    bins[bin] += 1
    used += 1
  }

  if (!used) return 0

  let sum = 0
  for (let i = 0; i < bins.length; i += 1) sum += bins[i] * bins[i]

  return sum / (used * used)
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

const rotateByAngle = (image: HTMLImageElement, angleDeg: number, transparent: boolean): string => {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) throw new Error('图片尺寸无效')

  const radians = (angleDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))

  const canvasWidth = Math.ceil(width * cos + height * sin)
  const canvasHeight = Math.ceil(width * sin + height * cos)

  const canvas = createCanvas(canvasWidth, canvasHeight)
  const context = getContext(canvas)

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  if (!transparent) {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvasWidth, canvasHeight)
  }

  context.translate(canvasWidth / 2, canvasHeight / 2)
  context.rotate(radians)
  context.drawImage(image, -width / 2, -height / 2, width, height)

  return canvas.toDataURL('image/png')
}

export async function deskewImage(dataUrl: string): Promise<DeskewResult> {
  const image = await loadImage(dataUrl)
  const analysis = analyzeSkew(image)
  const angle = detectSkewAngle(analysis)

  if (Math.abs(angle) < MIN_SKEW) {
    return { angle, changed: false, dataUrl }
  }

  return {
    angle,
    changed: true,
    dataUrl: rotateByAngle(image, angle, analysis.transparent)
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
  tolerance: number
): ColorRemovalResult {
  const { data } = sampler.imageData
  const limit = tolerance * tolerance
  let changed = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue

    const dr = data[i] - target.r
    const dg = data[i + 1] - target.g
    const db = data[i + 2] - target.b

    if (dr * dr + dg * dg + db * db > limit) continue

    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
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
  to: number
): number => {
  let changed = 0

  for (let x = from; x < to; x += 1) {
    const index = (row * width + x) * 4
    if (
      data[index] === 255 &&
      data[index + 1] === 255 &&
      data[index + 2] === 255 &&
      data[index + 3] === 255
    ) {
      continue
    }

    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
    data[index + 3] = 255
    changed += 1
  }

  return changed
}

export async function maskRegion(
  dataUrl: string,
  rect: RegionRect,
  mode: RegionMode
): Promise<ColorRemovalResult> {
  const sampler = await createPixelSampler(dataUrl)
  const { width, height, imageData, context, canvas } = sampler
  const { data } = imageData

  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)))
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)))
  const right = Math.max(left + 1, Math.min(width, Math.round((rect.x + rect.w) * width)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round((rect.y + rect.h) * height)))

  let changed = 0

  for (let row = 0; row < height; row += 1) {
    const insideRow = row >= top && row < bottom

    if (mode === 'remove') {
      if (insideRow) changed += blankRange(data, width, row, left, right)
      continue
    }

    if (!insideRow) {
      changed += blankRange(data, width, row, 0, width)
      continue
    }

    changed += blankRange(data, width, row, 0, left)
    changed += blankRange(data, width, row, right, width)
  }

  context.putImageData(imageData, 0, 0)

  return { dataUrl: canvas.toDataURL('image/png'), changed }
}

export interface CenterRegionResult extends ColorRemovalResult {
  offsetX: number
  offsetY: number
}

export async function centerRegion(dataUrl: string, rect: RegionRect): Promise<CenterRegionResult> {
  const sampler = await createPixelSampler(dataUrl)
  const { width, height, imageData, context, canvas } = sampler
  const { data } = imageData

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
  output.fill(255)

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