import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfPageImage {
  page: number
  width: number
  height: number
  dataUrl: string
  size: number
}

export interface RasterizePdfOptions {
  maxWidth?: number
  minScale?: number
  maxScale?: number
  quality?: number
  onProgress?: (page: number, total: number) => void
}

const DEFAULT_MAX_WIDTH = 2000
const DEFAULT_MIN_SCALE = 1
const DEFAULT_MAX_SCALE = 3
const DEFAULT_QUALITY = 0.92

const ASSET_BASE = 'app-asset://local/pdfjs/'

const decodeBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

const estimateSize = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  return Math.round(((dataUrl.length - comma - 1) * 3) / 4)
}

const createPageCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export async function rasterizePdf(
  base64: string,
  options: RasterizePdfOptions = {}
): Promise<PdfPageImage[]> {
  const {
    maxWidth = DEFAULT_MAX_WIDTH,
    minScale = DEFAULT_MIN_SCALE,
    maxScale = DEFAULT_MAX_SCALE,
    quality = DEFAULT_QUALITY,
    onProgress
  } = options

  const doc = await getDocument({
    data: decodeBase64(base64),
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    useSystemFonts: true
  }).promise

  const pages: PdfPageImage[] = []

  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(maxScale, Math.max(minScale, maxWidth / Math.max(1, base.width)))
      const viewport = page.getViewport({ scale })
      const canvas = createPageCanvas(viewport.width, viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建画布上下文')

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)

      await page.render({ canvasContext: context, viewport }).promise

      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      pages.push({
        page: index,
        width: canvas.width,
        height: canvas.height,
        dataUrl,
        size: estimateSize(dataUrl)
      })

      page.cleanup()
      onProgress?.(index, doc.numPages)
    }
  } finally {
    await doc.destroy()
  }

  return pages
}
