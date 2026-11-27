import { readdir, readFile, stat } from 'fs/promises'
import type { Dirent } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import fontkit from '@pdf-lib/fontkit'
import type { Font } from '@pdf-lib/fontkit'

export interface SystemFontStyle {
  /** 字面唯一标识（PostScript 名），跨启动稳定，用于保存选择结果 */
  postscriptName: string
  /** 字面名，如 Regular / Bold / Italic */
  subfamily: string
  bold: boolean
  italic: boolean
  /** 字面所在字体文件 */
  filePath: string
  /** 该字面在集合文件（.ttc/.otc）中的序号 */
  faceIndex: number
}

export interface SystemFontFamily {
  /** 字体族标识（英文族名，同时用于 SVG/CSS 渲染） */
  id: string
  /** 渲染用族名 */
  family: string
  /** 界面展示名，优先取字体自带的本地化（中文）族名 */
  displayName: string
  /** 是否包含常用中文字形 */
  cjk: boolean
  hasBold: boolean
  hasItalic: boolean
  styles: SystemFontStyle[]
}

export interface SystemFontList {
  families: SystemFontFamily[]
  /** 默认字体族标识 */
  defaultId: string
}

export interface ResolvedSystemFont {
  family: SystemFontFamily
  style: SystemFontStyle
}

interface RawFace {
  family: string
  localizedFamily: string
  cjk: boolean
  style: SystemFontStyle
}

const FONT_EXTENSIONS = /\.(ttf|ttc|otf|otc)$/i
const MAX_FONT_FILE_SIZE = 40 * 1024 * 1024
const MAX_SCAN_DEPTH = 4
/** 用「汉」作为中文字形探测点 */
const CJK_PROBE_CODE_POINT = 0x6c49

const BOLD_KEYWORDS = ['bold', 'black', 'heavy', 'semibold', 'demibold', 'extrabold', 'ultrabold']
const ITALIC_KEYWORDS = ['italic', 'oblique']

/** 默认字体优先顺序：先中文正文常用字体，再回退到首个可用字体 */
const PREFERRED_FAMILIES = [
  '微软雅黑',
  'Microsoft YaHei',
  'PingFang SC',
  '苹方-简',
  'Hiragino Sans GB',
  'Noto Sans CJK SC',
  '思源黑体',
  'Source Han Sans SC',
  'WenQuanYi Zen Hei',
  '文泉驿正黑',
  '宋体',
  'SimSun',
  '黑体',
  'SimHei',
  '等线',
  'DengXian'
]

const fontDirectories = (): string[] => {
  const home = homedir()

  if (process.platform === 'win32') {
    const windowsDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows'
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    return [join(windowsDir, 'Fonts'), join(localAppData, 'Microsoft', 'Windows', 'Fonts')]
  }

  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      join(home, 'Library', 'Fonts')
    ]
  }

  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    join(home, '.local', 'share', 'fonts'),
    join(home, '.fonts')
  ]
}

const walkFontFiles = async (dir: string, depth: number, output: string[]): Promise<void> => {
  if (depth > MAX_SCAN_DEPTH) return

  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      await walkFontFiles(fullPath, depth + 1, output)
      continue
    }

    if (entry.isFile() && FONT_EXTENSIONS.test(entry.name)) output.push(fullPath)
  }
}

/** 字体集合文件（.ttc/.otc）会返回多个字面，普通文件返回单个字面 */
const parseFaces = (buffer: Buffer): Font[] => {
  const parsed = fontkit.create(buffer as unknown as Uint8Array) as unknown as Font & {
    fonts?: Font[]
  }

  return Array.isArray(parsed.fonts) ? parsed.fonts : [parsed]
}

/** 读取字体 name 表中的本地化族名（优先中文） */
const readLocalizedName = (face: Font): string => {
  const records = (
    face as unknown as {
      name?: { records?: Record<string, Record<string, string>> }
    }
  ).name?.records?.fontFamily

  if (!records) return ''

  const candidates = ['zh', 'zh-Hans', 'zh-CN', 'zh-SG', 'zh-Hant', 'zh-TW']
  for (const key of candidates) {
    const value = records[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return ''
}

const hasCjkGlyph = (face: Font): boolean => {
  try {
    return face.hasGlyphForCodePoint(CJK_PROBE_CODE_POINT)
  } catch {
    return false
  }
}

const isBoldFace = (subfamily: string, postscriptName: string): boolean => {
  const text = `${subfamily} ${postscriptName}`.toLowerCase()
  return BOLD_KEYWORDS.some((keyword) => text.includes(keyword))
}

const isItalicFace = (subfamily: string, postscriptName: string): boolean => {
  const text = `${subfamily} ${postscriptName}`.toLowerCase()
  return ITALIC_KEYWORDS.some((keyword) => text.includes(keyword))
}

const scanFontFile = async (
  filePath: string,
  seen: Set<string>,
  output: RawFace[]
): Promise<void> => {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size === 0 || info.size > MAX_FONT_FILE_SIZE) return

    const buffer = await readFile(filePath)
    const faces = parseFaces(buffer)

    faces.forEach((face, faceIndex) => {
      const localizedFamily = readLocalizedName(face)
      const family = (face.familyName || localizedFamily || face.postscriptName || '').trim()
      if (!family) return

      const postscriptName = (face.postscriptName || `${family}-${faceIndex}`).trim()
      if (seen.has(postscriptName)) return
      seen.add(postscriptName)

      const subfamily = (face.subfamilyName || '').trim()

      output.push({
        family,
        localizedFamily,
        cjk: hasCjkGlyph(face),
        style: {
          postscriptName,
          subfamily,
          bold: isBoldFace(subfamily, postscriptName),
          italic: isItalicFace(subfamily, postscriptName),
          filePath,
          faceIndex
        }
      })
    })
  } catch (error) {
    // 少数旧式或损坏的字体文件无法解析，跳过即可，不影响其它字体
    console.warn(
      `Skip unreadable font file: ${filePath}`,
      error instanceof Error ? error.message : error
    )
  }
}

const aggregateFamilies = (raw: RawFace[]): SystemFontFamily[] => {
  const map = new Map<string, SystemFontFamily>()

  for (const item of raw) {
    const key = item.family.toLowerCase()
    let entry = map.get(key)

    if (!entry) {
      entry = {
        id: item.family,
        family: item.family,
        displayName: item.localizedFamily || item.family,
        cjk: false,
        hasBold: false,
        hasItalic: false,
        styles: []
      }
      map.set(key, entry)
    }

    if (item.localizedFamily && entry.displayName === entry.family) {
      entry.displayName = item.localizedFamily
    }

    entry.cjk = entry.cjk || item.cjk
    entry.hasBold = entry.hasBold || item.style.bold
    entry.hasItalic = entry.hasItalic || item.style.italic
    entry.styles.push(item.style)
  }

  return [...map.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'zh-Hans-CN')
  )
}

const pickDefaultId = (families: SystemFontFamily[]): string => {
  for (const preferred of PREFERRED_FAMILIES) {
    const hit = families.find(
      (item) =>
        item.family.toLowerCase() === preferred.toLowerCase() || item.displayName === preferred
    )
    if (hit) return hit.id
  }

  const cjkFamily = families.find((item) => item.cjk)
  return cjkFamily?.id ?? families[0]?.id ?? ''
}

let cachedList: SystemFontList | null = null
let pendingScan: Promise<SystemFontList> | null = null

/** 枚举当前系统可供应用使用的字体族（带内存缓存，force 为 true 时重新扫描） */
export const listSystemFonts = async (force = false): Promise<SystemFontList> => {
  if (cachedList && !force) return cachedList

  if (!pendingScan) {
    pendingScan = (async (): Promise<SystemFontList> => {
      const startedAt = Date.now()
      const files: string[] = []

      for (const dir of fontDirectories()) await walkFontFiles(dir, 1, files)

      const raw: RawFace[] = []
      const seen = new Set<string>()

      for (const file of files) await scanFontFile(file, seen, raw)

      const families = aggregateFamilies(raw)
      const defaultId = pickDefaultId(families)

      console.log(
        `System fonts scanned: ${files.length} files, ${families.length} families, ${Date.now() - startedAt}ms`
      )

      cachedList = { families, defaultId }
      return cachedList
    })().finally(() => {
      pendingScan = null
    })
  }

  return pendingScan
}

const findFamily = async (familyId: string): Promise<SystemFontFamily | null> => {
  const list = await listSystemFonts()
  const key = familyId.trim().toLowerCase()
  if (!key) return null

  return (
    list.families.find(
      (item) => item.id.toLowerCase() === key || item.family.toLowerCase() === key
    ) ?? null
  )
}

/**
 * 按族名与字形需求解析出真实字面。
 * 粗体/斜体只有在字体族内确实存在对应字面时才可用，否则返回 null（不做任何伪样式）。
 */
export const resolveSystemFont = async (
  familyId: string,
  bold: boolean,
  italic: boolean
): Promise<ResolvedSystemFont | null> => {
  const family = await findFamily(familyId)
  if (!family || !family.styles.length) return null
  if (bold && !family.hasBold) return null
  if (italic && !family.hasItalic) return null

  const exact = family.styles.find(
    (style) => style.bold === bold && style.italic === italic
  )
  if (exact) return { family, style: exact }

  // 用户明确要求了粗体/斜体却找不到对应字面时，宁可失败也不退回其它字面，
  // 否则会出现「选了粗体却渲染成常规」的假效果
  if (bold || italic) return null

  const style = family.styles.find((item) => !item.bold && !item.italic) ?? family.styles[0]
  if (!style) return null

  return { family, style }
}

/** 重新打开字面文件，用于度量文本与校验字形覆盖 */
export const loadFontFace = async (style: SystemFontStyle): Promise<Font> => {
  const buffer = await readFile(style.filePath)
  const faces = parseFaces(buffer)
  const face = faces[style.faceIndex] ?? faces[0]

  if (!face) throw new Error(`字体文件无法解析：${style.filePath}`)

  return face
}