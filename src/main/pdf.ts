import { nativeImage } from 'electron'

interface PdfImage {
  width: number
  height: number
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK'
  filter: 'DCTDecode' | 'FlateDecode'
  decodeParms?: string
  decode?: string
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

const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s

const JPEG_QUALITY = 90

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
])

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

function transcodeToJpeg(buffer: Buffer): PdfImage | null {
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return null

  const { width, height } = image.getSize()
  const jpeg = image.toJPEG(JPEG_QUALITY)
  if (!width || !height || !jpeg.length) return null

  return {
    width,
    height,
    colorSpace: 'DeviceRGB',
    filter: 'DCTDecode',
    data: Buffer.from(jpeg)
  }
}

function toPdfImage(dataUrl: string): PdfImage | null {
  const decoded = decodeDataUrl(dataUrl)
  if (!decoded) return null

  const { data } = decoded
  const format = sniffImageFormat(data)

  if (format === 'jpeg') {
    const info = parseJpeg(data)

    if (info?.baseline) {
      const colorSpace =
        info.components === 1 ? 'DeviceGray' : info.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'

      return {
        width: info.width,
        height: info.height,
        colorSpace,
        filter: 'DCTDecode',
        decode: info.components === 4 ? '[1 0 1 0 1 0 1 0]' : undefined,
        data
      }
    }
  }

  if (format === 'png') {
    const png = parsePng(data)

    if (
      png &&
      png.bitDepth === 8 &&
      png.interlace === 0 &&
      (png.colorType === 0 || png.colorType === 2)
    ) {
      const colors = png.colorType === 0 ? 1 : 3

      return {
        width: png.width,
        height: png.height,
        colorSpace: colors === 1 ? 'DeviceGray' : 'DeviceRGB',
        filter: 'FlateDecode',
        decodeParms: `<< /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${png.width} >>`,
        data: png.idat
      }
    }
  }

  return transcodeToJpeg(data)
}

function buildPdf(images: PdfImage[]): Buffer {
  const objects: Buffer[] = new Array(2 + images.length * 3)
  const pageIds: number[] = []

  images.forEach((image, index) => {
    const pageId = 3 + index * 3
    const contentId = pageId + 1
    const imageId = pageId + 2
    pageIds.push(pageId)

    const content = Buffer.from(
      `q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im0 Do\nQ\n`,
      'utf-8'
    )

    objects[pageId - 1] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      'utf-8'
    )

    objects[contentId - 1] = Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'utf-8'),
      content,
      Buffer.from('endstream', 'utf-8')
    ])

    const parts = [
      '<< /Type /XObject',
      '/Subtype /Image',
      `/Width ${image.width}`,
      `/Height ${image.height}`,
      `/ColorSpace /${image.colorSpace}`,
      '/BitsPerComponent 8',
      `/Filter /${image.filter}`,
      image.decodeParms ? `/DecodeParms ${image.decodeParms}` : '',
      image.decode ? `/Decode ${image.decode}` : '',
      `/Length ${image.data.length} >>`
    ].filter(Boolean)

    objects[imageId - 1] = Buffer.concat([
      Buffer.from(`${parts.join(' ')}\nstream\n`, 'utf-8'),
      image.data,
      Buffer.from('\nendstream', 'utf-8')
    ])
  })

  objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'utf-8')
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    'utf-8'
  )

  const header = Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'utf-8'),
    Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])
  ])

  const chunks: Buffer[] = [header]
  const offsets: number[] = []
  let offset = header.length

  objects.forEach((body, index) => {
    offsets.push(offset)

    const head = Buffer.from(`${index + 1} 0 obj\n`, 'utf-8')
    const tail = Buffer.from('\nendobj\n', 'utf-8')

    chunks.push(head, body, tail)
    offset += head.length + body.length + tail.length
  })

  const size = objects.length + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`

  for (const entry of offsets) {
    xref += `${String(entry).padStart(10, '0')} 00000 n \n`
  }

  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`

  chunks.push(Buffer.from(xref, 'utf-8'))

  return Buffer.concat(chunks)
}

export interface PdfBuildResult {
  pdf: Buffer | null
  used: number
  skipped: number
  skippedIndexes: number[]
}

export function buildPdfFromDataUrls(dataUrls: string[]): PdfBuildResult {
  const images: PdfImage[] = []
  const skippedIndexes: number[] = []

  dataUrls.forEach((dataUrl, index) => {
    const image = toPdfImage(dataUrl)
    if (!image) {
      skippedIndexes.push(index)
      return
    }
    images.push(image)
  })

  if (!images.length) return { pdf: null, used: 0, skipped: skippedIndexes.length, skippedIndexes }

  return {
    pdf: buildPdf(images),
    used: images.length,
    skipped: skippedIndexes.length,
    skippedIndexes
  }
}