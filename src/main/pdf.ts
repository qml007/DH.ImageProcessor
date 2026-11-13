import { app, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import {
  PDFDocument,
  PDFFont,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  type PDFImage as PdfLibImage
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

interface PdfImageData {
  width: number
  height: number
  data: Buffer
}

interface JpegInfo {
  width: number
  height: number
  components: number
  baseline: boolean
}

interface PngInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
  idat: Buffer
}

/** OCR 文字块，坐标为图像像素（左上角原点） */
export interface PdfTextBlock {
  text: string
  x: number
  y: number
  width: number
  height: number
}

const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s

const JPEG_QUALITY = 90

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
])

let fontBytesPromise: Promise<Buffer> | null = null

const fontPath = (): string => {
  const candidates = [
    join(process.resourcesPath, 'fonts', 'NotoSansSC-Regular.otf'),
    join(process.cwd(), 'resources', 'fonts', 'NotoSansSC-Regular.otf'),
    join(app.getAppPath(), 'resources', 'fonts', 'NotoSansSC-Regular.otf')
  ]

  return candidates.find((item) => existsSync(item)) ?? candidates[0]
}

const loadFontBytes = (): Promise<Buffer> => {
  if (!fontBytesPromise) {
    fontBytesPromise = readFile(fontPath()).catch((error) => {
      fontBytesPromise = null
      throw error
    })
  }
  return fontBytesPromise
}

function decodeDataUrl(dataUrl: string): { mime: string; data: Buffer } | null {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim())
  if (!match) return null

  return { mime: match[1].toLowerCase(), data: Buffer.from(match[2], 'base64') }
}

function sniffImageFormat(buffer: Buffer): 'jpeg' | 'png' | 'other' {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg'
  if (buffer.length >= 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png'
  return 'other'
}

function parseJpeg(buffer: Buffer): JpegInfo | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let offset = 2

  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    let marker = buffer[offset + 1]

    while (marker === 0xff && offset + 2 < buffer.length) {
      offset += 1
      marker = buffer[offset + 1]
    }

    offset += 2

    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) continue
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) break

    const segmentLength = buffer.readUInt16BE(offset)

    if (SOF_MARKERS.has(marker) && offset + 7 < buffer.length) {
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      const components = buffer.readUInt8(offset + 7)

      if (!width || !height || !components) return null

      return { width, height, components, baseline: marker === 0xc0 || marker === 0xc1 }
    }

    if (segmentLength < 2) break
    offset += segmentLength
  }

  return null
}

function parsePng(buffer: Buffer): PngInfo | null {
  if (buffer.length < 8) return null
  if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  const idats: Buffer[] = []

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (dataEnd > buffer.length) break

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataStart)
      height = buffer.readUInt32BE(dataStart + 4)
      bitDepth = buffer.readUInt8(dataStart + 8)
      colorType = buffer.readUInt8(dataStart + 9)
      interlace = buffer.readUInt8(dataStart + 12)
    } else if (type === 'IDAT') {
      idats.push(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }

    offset = dataEnd + 4
  }

  if (!width || !height || !idats.length) return null

  return { width, height, bitDepth, colorType, interlace, idat: Buffer.concat(idats) }
}

function transcodeToJpeg(buffer: Buffer): PdfImageData | null {
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return null

  const { width, height } = image.getSize()
  const jpeg = image.toJPEG(JPEG_QUALITY)
  if (!width || !height || !jpeg.length) return null

  return { width, height, data: Buffer.from(jpeg) }
}

interface EmbeddedPageImage {
  image: PdfLibImage
  width: number
  height: number
}

async function embedImage(doc: PDFDocument, dataUrl: string): Promise<EmbeddedPageImage | null> {
  const decoded = decodeDataUrl(dataUrl)
  if (!decoded) return null

  const format = sniffImageFormat(decoded.data)

  if (format === 'jpeg') {
    const info = parseJpeg(decoded.data)
    if (info) {
      try {
        const image = await doc.embedJpg(decoded.data)
        return { image, width: info.width, height: info.height }
      } catch {
        // CMYK 等特殊 JPEG 交给 nativeImage 重新编码
      }
    }
  }

  if (format === 'png') {
    const info = parsePng(decoded.data)
    if (info) {
      try {
        const image = await doc.embedPng(decoded.data)
        return { image, width: info.width, height: info.height }
      } catch {
        // 特殊 PNG 交给 nativeImage 重新编码
      }
    }
  }

  const jpeg = transcodeToJpeg(decoded.data)
  if (!jpeg) return null

  const image = await doc.embedJpg(jpeg.data)
  return { image, width: jpeg.width, height: jpeg.height }
}

/** 在图片上叠加不可见文字层（渲染模式 3），使 PDF 可搜索、可复制 */
function drawTextLayer(
  page: PDFPage,
  font: PDFFont,
  blocks: PdfTextBlock[],
  pageHeight: number
): void {
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(3)])
  )

  for (const block of blocks) {
    const text = block.text.replace(/\s+/g, ' ').trim()
    if (!text || block.width <= 0 || block.height <= 0) continue

    let size = Math.max(block.height * 0.9, 4)

    try {
      const naturalWidth = font.widthOfTextAtSize(text, size)
      if (naturalWidth > block.width) {
        size *= block.width / naturalWidth
      }

      const y = pageHeight - block.y - block.height + (block.height - size) / 2
      page.drawText(text, { x: block.x, y, size, font })
    } catch {
      // 个别字符无法编码时跳过该行，不影响图片页
    }
  }

  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(0)])
  )
}

export interface PdfBuildResult {
  pdf: Buffer | null
  used: number
  skipped: number
  skippedIndexes: number[]
}

export async function buildPdfFromDataUrls(
  dataUrls: string[],
  textPages: Array<PdfTextBlock[] | undefined> = []
): Promise<PdfBuildResult> {
  const skippedIndexes: number[] = []
  const doc = await PDFDocument.create()

  // 只有确有可绘制的文字块时才嵌入字体：无文字时仍然子集化字体，
  // 会让 @pdf-lib/fontkit 的 CFFSubset 在保存阶段抛出未捕获的 RangeError
  const hasDrawableText = textPages.some((blocks) =>
    blocks?.some(
      (block) => !!block.text.replace(/\s+/g, ' ').trim() && block.width > 0 && block.height > 0
    )
  )

  let font: PDFFont | null = null
  if (hasDrawableText) {
    try {
      doc.registerFontkit(fontkit)
      font = await doc.embedFont(await loadFontBytes(), { subset: true })
    } catch (error) {
      console.error('Failed to embed OCR font, exporting image-only PDF:', error)
    }
  }

  let used = 0

  for (let index = 0; index < dataUrls.length; index += 1) {
    const embedded = await embedImage(doc, dataUrls[index])
    if (!embedded) {
      skippedIndexes.push(index)
      continue
    }

    const page = doc.addPage([embedded.width, embedded.height])
    page.drawImage(embedded.image, { x: 0, y: 0, width: embedded.width, height: embedded.height })

    const blocks = textPages[index]
    if (font && blocks?.length) {
      drawTextLayer(page, font, blocks, embedded.height)
    }

    used += 1
  }

  if (!used) {
    return { pdf: null, used: 0, skipped: skippedIndexes.length, skippedIndexes }
  }

  const bytes = await doc.save()

  return {
    pdf: Buffer.from(bytes),
    used,
    skipped: skippedIndexes.length,
    skippedIndexes
  }
}
