import sharp from 'sharp'
import { loadFontFace, resolveSystemFont } from './fonts'

export interface ComposePageNumberPayload {
  /** 当前图像（data URL） */
  dataUrl: string
  /** 页码内容 */
  text: string
  /** 字体族标识 */
  family: string
  bold?: boolean
  italic?: boolean
  /** 字号，以图片原始像素为单位 */
  sizePx: number
  /** 颜色，#RRGGBB */
  color: string
  /** 排版方向 */
  direction?: 'horizontal' | 'vertical'
  /** 定位点：相对图像宽高的比例（0~1），对应文本包围盒中心 */
  anchorX: number
  anchorY: number
}

export interface ComposePageNumberResult {
  ok: boolean
  dataUrl?: string
  message?: string
}

const MAX_TEXT_LENGTH = 64
const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 4000
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** 校验字体是否覆盖全部字符，缺字时返回缺失的字符 */
const findMissingChars = (
  face: Awaited<ReturnType<typeof loadFontFace>>,
  text: string
): string[] => {
  const missing = new Set<string>()

  for (const char of text) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined || codePoint === 0x20) continue

    let supported = false
    try {
      supported = face.hasGlyphForCodePoint(codePoint)
    } catch {
      supported = true
    }

    if (!supported) missing.add(char)
  }

  return [...missing]
}

interface InkBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** 逐字形累加计算墨迹包围盒（字体单位，y 轴向上）；取不到字形轮廓时返回 null */
const measureInkBox = (
  face: Awaited<ReturnType<typeof loadFontFace>>,
  text: string
): InkBox | null => {
  try {
    const run = face.layout(text)
    let penX = 0
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    run.glyphs.forEach((glyph, index) => {
      const bbox = (glyph as unknown as { bbox?: InkBox }).bbox
      if (bbox) {
        minX = Math.min(minX, penX + bbox.minX)
        maxX = Math.max(maxX, penX + bbox.maxX)
        minY = Math.min(minY, bbox.minY)
        maxY = Math.max(maxY, bbox.maxY)
      }

      penX += run.positions[index]?.xAdvance ?? glyph.advanceWidth ?? 0
    })

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null
    if (maxX <= minX || maxY <= minY) return null

    return { minX, maxX, minY, maxY }
  } catch {
    return null
  }
}

export const composePageNumber = async (
  payload: ComposePageNumberPayload
): Promise<ComposePageNumberResult> => {
  try {
    const match = DATA_URL_PATTERN.exec(payload?.dataUrl?.trim() ?? '')
    if (!match) return { ok: false, message: '图片数据格式无效' }

    const text = (payload.text ?? '').trim()
    if (!text) return { ok: false, message: '请输入页码内容' }
    if (text.length > MAX_TEXT_LENGTH) {
      return { ok: false, message: `页码内容过长，最多 ${MAX_TEXT_LENGTH} 个字符` }
    }
    if (/[\r\n\t]/.test(text)) {
      return { ok: false, message: '页码内容不支持换行或制表符' }
    }

    const sizePx = Number(payload.sizePx)
    if (!Number.isFinite(sizePx) || sizePx < MIN_FONT_SIZE || sizePx > MAX_FONT_SIZE) {
      return {
        ok: false,
        message: `字号需在 ${MIN_FONT_SIZE}~${MAX_FONT_SIZE} 像素之间`
      }
    }

    const color = (payload.color ?? '').trim()
    if (!COLOR_PATTERN.test(color)) return { ok: false, message: '页码颜色格式无效' }

    const anchorX = Number(payload.anchorX)
    const anchorY = Number(payload.anchorY)
    if (
      !Number.isFinite(anchorX) ||
      !Number.isFinite(anchorY) ||
      anchorX < 0 ||
      anchorX > 1 ||
      anchorY < 0 ||
      anchorY > 1
    ) {
      return { ok: false, message: '页码位置无效，请重新选择位置' }
    }

    const resolved = await resolveSystemFont(payload.family, !!payload.bold, !!payload.italic)
    if (!resolved) {
      const detail = payload.bold || payload.italic ? '字体或所选字形' : '字体'
      return { ok: false, message: `所选${detail}在当前系统中不可用，请重新选择` }
    }

    const face = await loadFontFace(resolved.style)

    const missing = findMissingChars(face, text)
    if (missing.length) {
      return {
        ok: false,
        message: `所选字体缺少字符「${missing.join('')}」，请更换字体或修改页码内容`
      }
    }

    const inputBuffer = Buffer.from(match[2], 'base64')
    const meta = await sharp(inputBuffer).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (!width || !height) return { ok: false, message: '无法读取图片尺寸' }

    const unitsPerEm = face.unitsPerEm || 1000
    const scale = sizePx / unitsPerEm
    const ink = measureInkBox(face, text)
    const advanceWidth = (face.layout(text).advanceWidth || 0) * scale

    // 优先用字形墨迹尺寸，使定位点对准实际可见文字的中心（与界面预览一致）
    const inkWidth = ink ? (ink.maxX - ink.minX) * scale : advanceWidth
    const inkHeight = ink ? (ink.maxY - ink.minY) * scale : (face.ascent - face.descent) * scale

    if (
      !Number.isFinite(inkWidth) ||
      !Number.isFinite(inkHeight) ||
      inkWidth <= 0 ||
      inkHeight <= 0
    ) {
      return { ok: false, message: '页码文本度量失败，请更换字体重试' }
    }

    const vertical = payload.direction === 'vertical'
    const boxWidth = vertical ? inkHeight : inkWidth
    const boxHeight = vertical ? inkWidth : inkHeight

    // 定位点对应包围盒中心，边界处向内收，避免页码被裁切
    const centerX = Math.min(Math.max(anchorX * width, boxWidth / 2), width - boxWidth / 2)
    const centerY = Math.min(Math.max(anchorY * height, boxHeight / 2), height - boxHeight / 2)

    // 墨迹中心相对文字起点的偏移（像素，y 轴向上为正）
    const inkCenterX = ink ? ((ink.minX + ink.maxX) / 2) * scale : advanceWidth / 2
    const inkCenterY = ink
      ? ((ink.minY + ink.maxY) / 2) * scale
      : ((face.ascent + face.descent) / 2) * scale

    // 垂直排布：以文字起点为旋转中心顺时针转 90°，使文字自上而下阅读
    const left = vertical ? centerX - inkCenterY : centerX - inkCenterX
    const baseline = vertical ? centerY - inkCenterX : centerY + inkCenterY

    const anchor = vertical ? `rotate(90 ${left} ${baseline})` : undefined

    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<text x="${left}" y="${baseline}"` +
        ` font-family="${escapeXml(resolved.family.family)}"` +
        ` font-size="${sizePx}"` +
        ` fill="${color}"` +
        (payload.bold ? ' font-weight="bold"' : '') +
        (payload.italic ? ' font-style="italic"' : '') +
        (anchor ? ` transform="${anchor}"` : '') +
        `>${escapeXml(text)}</text></svg>`
    )

    const output = await sharp(inputBuffer)
      .composite([{ input: svg, top: 0, left: 0 }])
      .png()
      .toBuffer()

    return { ok: true, dataUrl: `data:image/png;base64,${output.toString('base64')}` }
  } catch (error) {
    console.error('Failed to compose page number:', error)
    return { ok: false, message: '插入页码失败' }
  }
}