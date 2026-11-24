import { app, shell, BrowserWindow, ipcMain, dialog, net, protocol } from 'electron'
import { execFile } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { basename, extname, isAbsolute, join, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import { mkdir, open, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import sharp from 'sharp'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/dh.png?asset'
import { buildPdfFromDataUrls } from './pdf'
import { writeArchivesExcel } from './excel'
import { recognizeDataUrl, recognizeImageWithCache, shutdownOcrWorker } from './ocr'
import { testAiConnection } from './ai/testConnection'
import { streamChatCompletion, type AiChatMessageInput } from './ai/chat'
import {
  closeDatabase,
  countArcImageByArcIds,
  createAiSettingInfo,
  createArcFieldInfo,
  createArcImageBatch,
  createArcImageHistory,
  createArcInfo,
  createArcType,
  createBatArcFieldInfo,
  createBatInfoWithSnapshot,
  DEFAULT_BG_COLOR,
  DEFAULT_BG_COLOR_CONFIG_KEY,
  deleteAiSettingInfo,
  deleteArcFieldInfo,
  deleteArcImage,
  deleteArcInfo,
  deleteArcType,
  deleteBatArcFieldInfo,
  deleteBatInfo,
  deleteConfig,
  getAiSettingInfo,
  getArcType,
  getBatInfo,
  getConfig,
  initializeDatabase,
  listAiSettingInfo,
  listArcFieldValue,
  listArcFieldInfo,
  listArcImage,
  listArcImageHistory,
  listArcInfo,
  listArcType,
  listBatArcFieldInfo,
  listBatInfo,
  listConfig,
  maskApiKey,
  normalizeBgColor,
  setConfig,
  setDefaultAiSettingInfo,
  syncArcFieldValue,
  truncateArcImageHistory,
  updateAiSettingInfo,
  updateArcFieldInfo,
  updateArcImage,
  updateArcInfo,
  updateArcType,
  updateBatArcFieldInfo,
  updateBatInfoWithSnapshot,
  upsertArcFieldValue,
  type AiSettingInfoRow
} from './db/index'

const ASSET_SCHEME = 'app-asset'
const ASSET_HOST = 'local'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

// 兜底捕获主进程未处理异常，避免直接崩溃退出，并给出友好提示
let errorDialogVisible = false

const reportMainProcessError = (error: unknown): void => {
  console.error('Unhandled main process error:', error)

  if (errorDialogVisible) return
  errorDialogVisible = true

  try {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      '程序异常',
      `操作过程中出现异常，当前任务已中断，请重试。\n\n${message}`
    )
  } catch (dialogError) {
    console.error('Failed to show error dialog:', dialogError)
  } finally {
    errorDialogVisible = false
  }
}

process.on('uncaughtException', reportMainProcessError)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in main process:', reason)
})

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const PDF_EXTENSION = 'pdf'
const MAX_PDF_SIZE = 200 * 1024 * 1024

interface ImportedImage {
  path: string
  name: string
  ext: string
  size: number
  dataUrl: string
}

interface PdfSourceFile {
  path: string
  name: string
  size: number
}

interface AppSettings {
  tempDir: string
  defaultBgColor: string
}

/** 返回给渲染进程的 AI 服务视图，不含完整密钥 */
interface AiSettingView {
  aiId: string
  name: string
  protocol: string
  baseUrl: string
  model: string
  supportsVision: number
  isDefault: number
  advancedParams: AiSettingInfoRow['advancedParams']
  sortNo: number
  timeOfCreate: string
  timeOfUpdate: string
  apiKeyMasked: string
  hasApiKey: number
}

interface PdfExportArchive {
  name: string
  images: string[]
  fileName?: string
  metas?: Array<{ imageId: string; historyId: string }>
}

interface PdfExportPayload {
  dir: string
  archives: PdfExportArchive[]
  silent?: boolean
  doubleLayer?: boolean
}

interface PdfExportFailure {
  name: string
  message: string
}

interface ArchiveExcelExportPayload {
  batId: string
}

interface PdfExportArchiveResult {
  name: string
  fileName: string
  ok: boolean
  used: number
  skipped: number
  skippedIndexes: number[]
  message: string
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif'
}

let settingsCache: AppSettings | null = null

const TEMP_DIR_CONFIG_KEY = 'TEMP_DIR_PATH'

function defaultTempDir(): string {
  return join(app.getPath('temp'), 'electron-admin-images')
}

async function loadSettings(): Promise<AppSettings> {
  if (settingsCache) return settingsCache

  const fallback: AppSettings = {
    tempDir: defaultTempDir(),
    defaultBgColor: DEFAULT_BG_COLOR
  }

  try {
    const tempRow = getConfig(TEMP_DIR_CONFIG_KEY)
    const bgColorRow = getConfig(DEFAULT_BG_COLOR_CONFIG_KEY)
    settingsCache = {
      tempDir: tempRow?.configValue.trim() || fallback.tempDir,
      defaultBgColor: normalizeBgColor(bgColorRow?.configValue) || fallback.defaultBgColor
    }
  } catch (error) {
    console.error('Failed to read settings from database:', error)
    settingsCache = fallback
  }

  return settingsCache
}

async function saveSettings(next: AppSettings): Promise<void> {
  setConfig(TEMP_DIR_CONFIG_KEY, next.tempDir, '临时文件夹路径')
  setConfig(DEFAULT_BG_COLOR_CONFIG_KEY, next.defaultBgColor, '默认底色')
  settingsCache = next
}

async function ensureTempDir(): Promise<string> {
  const { tempDir } = await loadSettings()
  await mkdir(tempDir, { recursive: true })
  return tempDir
}

// 部分主板厂商会返回占位符，这类值不能作为指纹来源
const INVALID_SERIAL_VALUES = new Set([
  '',
  'none',
  'unknown',
  'n/a',
  'not specified',
  'default string',
  'to be filled by o.e.m.',
  'system serial number',
  'not available',
  'invalid'
])

function normalizeSerial(raw: string): string {
  const value = raw.trim()
  return INVALID_SERIAL_VALUES.has(value.toLowerCase()) ? '' : value
}

function runCommand(file: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10000 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolvePromise(stdout)
    })
  })
}

async function readSerialFile(file: string): Promise<string> {
  try {
    return normalizeSerial(await readFile(file, 'utf8'))
  } catch {
    return ''
  }
}

// Windows：通过 PowerShell 的 CIM 接口读取主板序列号
async function readWindowsSerial(): Promise<string> {
  const stdout = await runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-CimInstance -ClassName Win32_BaseBoard).SerialNumber'
  ])
  return normalizeSerial(stdout)
}

// Linux：优先读取 DMI 中的主板序列号，普通用户无权限时退回系统机器标识
async function readLinuxSerial(): Promise<string> {
  const dmiFiles = ['/sys/class/dmi/id/board_serial', '/sys/class/dmi/id/product_serial']

  for (const file of dmiFiles) {
    const serial = await readSerialFile(file)
    if (serial) return serial
  }

  const machineId =
    (await readSerialFile('/etc/machine-id')) || (await readSerialFile('/var/lib/dbus/machine-id'))

  if (machineId) return machineId

  throw new Error('Unable to read a stable machine identifier')
}

// macOS：IOPlatformSerialNumber 为整机硬件序列号
async function readDarwinSerial(): Promise<string> {
  const stdout = await runCommand('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
  const match = /"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/.exec(stdout)
  return normalizeSerial(match?.[1] ?? '')
}

async function readMachineSerial(): Promise<string> {
  if (process.platform === 'win32') return readWindowsSerial()
  if (process.platform === 'darwin') return readDarwinSerial()
  return readLinuxSerial()
}

let machineCodeCache = ''

async function getMachineCode(): Promise<string> {
  if (machineCodeCache) return machineCodeCache

  const serial = await readMachineSerial()
  if (!serial) throw new Error('Empty machine serial number')

  machineCodeCache = createHash('md5').update(serial).digest('hex')
  return machineCodeCache
}

async function resolveTempPath(target: string): Promise<string | null> {
  const tempDir = await ensureTempDir()
  const root = resolve(tempDir)
  // 数据库里保存的是相对于临时文件夹的路径，需要以临时目录为基准解析
  const full = isAbsolute(target) ? resolve(target) : resolve(root, target)
  const rel = relative(root, full)

  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null

  return full
}

async function readImageFile(filePath: string): Promise<ImportedImage | null> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > MAX_IMAGE_SIZE) return null

    const ext = extname(filePath).slice(1).toLowerCase()
    const mime = IMAGE_MIME_TYPES[ext]
    if (!mime) return null

    const buffer = await readFile(filePath)
    return {
      path: filePath,
      name: basename(filePath),
      ext,
      size: fileStat.size,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
    }
  } catch (error) {
    console.error('Failed to read image:', filePath, error)
    return null
  }
}

interface ImageBitDepthInfo {
  /** 每像素总位数，如 RGB(8×3) 为 24 */
  depth: number
  /** 颜色模式描述，如 RGB / RGBA / 索引 */
  colorMode: string
}

/** 位深度解析只需读取文件头，256KB 足以覆盖常见格式的元数据 */
const BIT_DEPTH_HEADER_SIZE = 262144

/** 去黑边：从每条边向内清理的最大范围（占该方向边长的比例） */
const BORDER_CLEAN_RANGE_RATIO = 0.2
/** 去黑边：黑边外侧允许存在的白边宽度（占该方向边长的比例） */
const BORDER_CLEAN_GAP_RATIO = 0.02
/** 去黑边：黑边内部允许的零散亮点（最多连续几个），避免噪点中断检测 */
const BORDER_CLEAN_HOLE_TOLERANCE = 3
/** 去黑边：亮度低于该值视为黑边像素（含抗锯齿灰边） */
const BORDER_DARK_THRESHOLD = 185
/** 去黑边：在黑边内侧额外清理的像素，用于吃掉抗锯齿光晕 */
const BORDER_CLEAN_FEATHER = 2

function describeJpegComponents(components: number): string {
  if (components === 1) return '灰度'
  if (components === 3) return 'RGB'
  if (components === 4) return 'CMYK'
  return ''
}

/** 通过文件头解析图像的位深度与颜色模式 */
function parseImageHeader(buffer: Buffer): ImageBitDepthInfo | null {
  // PNG：IHDR 中第 24 字节为每通道位深度，第 25 字节为颜色类型
  if (
    buffer.length >= 26 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const bitDepth = buffer[24]
    const colorType = buffer[25]
    const modes: Record<number, string> = {
      0: '灰度',
      2: 'RGB',
      3: '索引',
      4: '灰度+Alpha',
      6: 'RGBA'
    }
    // 索引色按每像素位深统计，其余按 位深度×通道数 得到每像素总位数
    const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
    return { depth: bitDepth * (channels[colorType] ?? 1), colorMode: modes[colorType] ?? '' }
  }

  // JPEG：遍历标记段，定位 SOFn 帧头
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 10 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }

      const marker = buffer[offset + 1]
      if (marker === 0xff) {
        offset += 1
        continue
      }

      // 无长度字段的独立标记
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }

      // 到达图像数据或文件末尾仍未找到帧头
      if (marker === 0xd9 || marker === 0xda) return null

      const length = (buffer[offset + 2] << 8) | buffer[offset + 3]
      if (length < 2) return null

      // SOF0~SOF15，排除 DHT(C4)/JPG(C8)/DAC(CC)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const precision = buffer[offset + 4]
        const components = buffer[offset + 9]
        return {
          depth: precision * components,
          colorMode: describeJpegComponents(components)
        }
      }

      offset += 2 + length
    }
    return null
  }

  // GIF：调色板最多 256 色，固定按 8 位索引色统计
  if (buffer.length >= 11 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { depth: 8, colorMode: '索引' }
  }

  // BMP：文件头偏移 28 处为位深度
  if (buffer.length >= 30 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    const depth = buffer.readUInt16LE(28)
    const modes: Record<number, string> = {
      1: '单色',
      4: '索引',
      8: '索引',
      16: 'RGB',
      24: 'RGB',
      32: 'RGBA'
    }
    return { depth, colorMode: modes[depth] ?? '' }
  }

  // WebP：遍历 RIFF 块，VP8 为有损(24 位)，VP8L 为无损(32 位)
  if (
    buffer.length >= 30 &&
    buffer[0] === 0x52 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    let offset = 12
    while (offset + 8 <= buffer.length) {
      const tag = buffer.toString('ascii', offset, offset + 4)
      const size = buffer.readUInt32LE(offset + 4)
      if (tag === 'VP8 ') return { depth: 24, colorMode: 'RGB' }
      if (tag === 'VP8L') return { depth: 32, colorMode: 'RGBA' }
      offset += tag === 'VP8X' ? 18 : 8 + size + (size % 2)
    }
    return null
  }

  // ICO：目录项偏移 14 处为位深度
  if (
    buffer.length >= 16 &&
    buffer[0] === 0 &&
    buffer[1] === 0 &&
    buffer[2] === 1 &&
    buffer[3] === 0
  ) {
    const depth = buffer.readUInt16LE(14)
    return { depth: depth || 32, colorMode: depth === 32 ? 'RGBA' : '' }
  }

  return null
}

async function detectImageBitDepth(filePath: string): Promise<ImageBitDepthInfo | null> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(BIT_DEPTH_HEADER_SIZE)
    const { bytesRead } = await handle.read(buffer, 0, BIT_DEPTH_HEADER_SIZE, 0)
    return parseImageHeader(buffer.subarray(0, bytesRead))
  } catch (error) {
    console.error('Failed to detect image bit depth:', filePath, error)
    return null
  } finally {
    await handle.close()
  }
}

async function readPdfSource(filePath: string): Promise<PdfSourceFile | null> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > MAX_PDF_SIZE) return null

    return { path: filePath, name: basename(filePath), size: fileStat.size }
  } catch (error) {
    console.error('Failed to read PDF:', filePath, error)
    return null
  }
}

function isPdfPath(filePath: string): boolean {
  return extname(filePath).slice(1).toLowerCase() === PDF_EXTENSION
}

function sanitizeFileName(name: string): string {
  const cleaned = Array.from(name)
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)

  return cleaned || 'archive'
}

function staticAssetRoot(): string {
  return is.dev ? join(__dirname, '../../src/renderer/public') : join(__dirname, '../renderer')
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: '德鸿图像处理系统',
    backgroundColor: '#f4f6fa',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Serve bundled static assets (pdf.js cmaps / standard fonts) over a fetchable scheme
  protocol.handle(ASSET_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url)

    if (host !== ASSET_HOST) {
      return new Response('Not found', { status: 404 })
    }

    const root = resolve(staticAssetRoot())
    const target = resolve(join(root, decodeURIComponent(pathname)))
    const rel = relative(root, target)

    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      return new Response('Not found', { status: 404 })
    }

    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch (error) {
      console.error('Failed to serve asset:', target, error)
      return new Response('Not found', { status: 404 })
    }
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Initialize the shared SQLite database (ProgramData by default)
  const dbState = initializeDatabase()
  if (!dbState.ok) {
    console.error('Database unavailable:', dbState.message)
  }

  ipcMain.handle('db:info', () => dbState)

  const dbError = (error: unknown): { ok: false; message: string } => {
    console.error('Database operation failed:', error)
    return { ok: false, message: error instanceof Error ? error.message : '数据库操作失败' }
  }

  ipcMain.handle('db:config-list', () => {
    try {
      return { ok: true, items: listConfig() }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle('db:config-get', (_event, payload: { configKey: string }) => {
    try {
      return { ok: true, item: getConfig(payload.configKey) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'db:config-set',
    (_event, payload: { configKey: string; configValue: string; memo?: string }) => {
      try {
        setConfig(payload.configKey, payload.configValue, payload.memo)
        return { ok: true }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('db:config-delete', (_event, payload: { configKey: string }) => {
    try {
      return { ok: true, removed: deleteConfig(payload.configKey) }
    } catch (error) {
      return dbError(error)
    }
  })

  // ---------- AI 服务配置 AISettingInfo ----------
  // 完整密钥只留在主进程，渲染进程只拿到掩码
  const toAiSettingView = (row: AiSettingInfoRow): AiSettingView => ({
    aiId: row.aiId,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    model: row.model,
    supportsVision: row.supportsVision,
    isDefault: row.isDefault,
    advancedParams: row.advancedParams,
    sortNo: row.sortNo,
    timeOfCreate: row.timeOfCreate,
    timeOfUpdate: row.timeOfUpdate,
    apiKeyMasked: maskApiKey(row.apiKey),
    hasApiKey: row.apiKey ? 1 : 0
  })

  type AiAdvancedParamPayload = {
    key: string
    type: 'text' | 'number' | 'boolean'
    value: string
  }

  ipcMain.handle('aisetting:list', () => {
    try {
      return { ok: true, items: listAiSettingInfo().map(toAiSettingView) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'aisetting:create',
    (
      _event,
      payload: {
        name: string
        protocol: string
        baseUrl: string
        apiKey?: string
        model: string
        supportsVision: number
        advancedParams?: AiAdvancedParamPayload[]
        sortNo?: number
      }
    ) => {
      try {
        return { ok: true, item: toAiSettingView(createAiSettingInfo(payload)) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle(
    'aisetting:update',
    (
      _event,
      payload: {
        aiId: string
        protocol: string
        baseUrl: string
        apiKey?: string
        model: string
        supportsVision: number
        advancedParams?: AiAdvancedParamPayload[]
        sortNo?: number
      }
    ) => {
      try {
        const { aiId, ...input } = payload
        const item = updateAiSettingInfo(aiId, input)
        if (!item) return { ok: false, message: '该 AI 服务不存在或已被删除' }
        return { ok: true, item: toAiSettingView(item) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('aisetting:delete', (_event, payload: { aiId: string }) => {
    try {
      return { ok: true, removed: deleteAiSettingInfo(payload.aiId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle('aisetting:set-default', (_event, payload: { aiId: string }) => {
    try {
      const item = setDefaultAiSettingInfo(payload.aiId)
      if (!item) return { ok: false, message: '该 AI 服务不存在或已被删除' }
      return { ok: true, item: toAiSettingView(item) }
    } catch (error) {
      return dbError(error)
    }
  })

  // 测试连接：密钥留空时沿用数据库中已保存的密钥
  ipcMain.handle(
    'aisetting:test',
    async (
      _event,
      payload: {
        aiId?: string
        baseUrl: string
        apiKey?: string
        model: string
        supportsVision: number
        advancedParams?: AiAdvancedParamPayload[]
      }
    ) => {
      try {
        const stored = payload.aiId ? getAiSettingInfo(payload.aiId) : null
        return await testAiConnection({
          baseUrl: payload.baseUrl,
          apiKey: (payload.apiKey ?? '').trim() || stored?.apiKey || '',
          model: payload.model,
          supportsVision: payload.supportsVision,
          advancedParams: payload.advancedParams ?? []
        })
      } catch (error) {
        console.error('AI connection test failed:', error)
        return {
          ok: false,
          message: error instanceof Error ? error.message : '测试连接失败',
          latencyMs: 0,
          vision: 'not-tested'
        }
      }
    }
  )

  // ---------- AI 对话（流式，不落库） ----------
  const aiChatControllers = new Map<string, AbortController>()

  ipcMain.handle(
    'ai:chat-start',
    (
      event,
      payload: { requestId: string; aiId: string; messages: AiChatMessageInput[] }
    ): { ok: boolean; message?: string } => {
      const setting = getAiSettingInfo(payload.aiId)
      if (!setting) return { ok: false, message: 'AI 服务不存在或已被删除' }
      if (!setting.baseUrl.trim() || !setting.model.trim()) {
        return { ok: false, message: '该 AI 服务缺少 Base URL 或模型' }
      }

      const { requestId } = payload
      const sender = event.sender
      const controller = new AbortController()
      aiChatControllers.set(requestId, controller)

      const send = (
        type: 'delta' | 'done' | 'error',
        data: { delta?: string; message?: string; aborted?: boolean } = {}
      ): void => {
        if (!sender.isDestroyed()) sender.send('ai:chat-event', { requestId, type, ...data })
      }

      void (async (): Promise<void> => {
        try {
          await streamChatCompletion(setting, payload.messages ?? [], controller.signal, (delta) => {
            send('delta', { delta })
          })
          send('done', {})
        } catch (error) {
          if (controller.signal.aborted) {
            send('done', { aborted: true })
          } else {
            console.error('AI chat failed:', error)
            send('error', { message: error instanceof Error ? error.message : 'AI 响应失败' })
          }
        } finally {
          aiChatControllers.delete(requestId)
        }
      })()

      // 立即返回，正文通过 ai:chat-event 逐段推送
      return { ok: true }
    }
  )

  ipcMain.on('ai:chat-abort', (_event, payload: { requestId: string }) => {
    aiChatControllers.get(payload.requestId)?.abort()
  })

  // 对话图片只临时写入临时文件夹，关闭页面即丢弃，不入库
  ipcMain.handle('ai:chat-save-image', async (_event, payload: { dataUrl: string }) => {
    try {
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(payload.dataUrl)
      if (!match) return { ok: false, message: '图片数据格式无效' }

      const ext = MIME_TO_EXT[match[1]] ?? 'png'
      const tempDir = await ensureTempDir()
      await mkdir(join(tempDir, 'ai-chat'), { recursive: true })

      const fileName = `${Date.now()}-${randomUUID()}.${ext}`
      await writeFile(join(tempDir, 'ai-chat', fileName), Buffer.from(match[2], 'base64'))
      return { ok: true, relPath: `ai-chat/${fileName}` }
    } catch (error) {
      console.error('Failed to save AI chat image:', error)
      return { ok: false, message: '写入临时文件夹失败' }
    }
  })

  // arcType 档案类型 CRUD
  ipcMain.handle('arcType:list', (_event, payload?: { includeDisabled?: boolean }) => {
    try {
      return { ok: true, items: listArcType(payload?.includeDisabled ?? true) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle('arcType:get', (_event, payload: { typeId: string }) => {
    try {
      return { ok: true, item: getArcType(payload.typeId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'arcType:create',
    (
      _event,
      payload: { arcTypeCode: string; arcTypeName: string; statusFlag: number; memo?: string }
    ) => {
      try {
        return {
          ok: true,
          item: createArcType({
            arcTypeCode: payload.arcTypeCode,
            arcTypeName: payload.arcTypeName,
            statusFlag: payload.statusFlag,
            memo: payload.memo
          })
        }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle(
    'arcType:update',
    (
      _event,
      payload: {
        typeId: string
        arcTypeCode: string
        arcTypeName: string
        statusFlag: number
        memo?: string
      }
    ) => {
      try {
        return {
          ok: true,
          item: updateArcType(payload.typeId, {
            arcTypeCode: payload.arcTypeCode,
            arcTypeName: payload.arcTypeName,
            statusFlag: payload.statusFlag,
            memo: payload.memo
          })
        }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('arcType:delete', (_event, payload: { typeId: string }) => {
    try {
      return { ok: true, removed: deleteArcType(payload.typeId) }
    } catch (error) {
      return dbError(error)
    }
  })

  // arcFieldInfo 档案类型字段 CRUD
  ipcMain.handle('arcFieldInfo:list', (_event, payload: { arcTypeId: string }) => {
    try {
      return { ok: true, items: listArcFieldInfo(payload.arcTypeId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'arcFieldInfo:create',
    (
      _event,
      payload: {
        arcTypeId: string
        sortNo: number
        fieldName: string
        fieldType: string
        isRequired: number
        memo?: string
      }
    ) => {
      try {
        return {
          ok: true,
          item: createArcFieldInfo({
            arcTypeId: payload.arcTypeId,
            sortNo: payload.sortNo,
            fieldName: payload.fieldName,
            fieldType: payload.fieldType,
            isRequired: payload.isRequired,
            memo: payload.memo
          })
        }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle(
    'arcFieldInfo:update',
    (
      _event,
      payload: {
        fieldId: string
        arcTypeId: string
        sortNo: number
        fieldName: string
        fieldType: string
        isRequired: number
        memo?: string
      }
    ) => {
      try {
        return {
          ok: true,
          item: updateArcFieldInfo(payload.fieldId, {
            arcTypeId: payload.arcTypeId,
            sortNo: payload.sortNo,
            fieldName: payload.fieldName,
            fieldType: payload.fieldType,
            isRequired: payload.isRequired,
            memo: payload.memo
          })
        }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('arcFieldInfo:delete', (_event, payload: { fieldId: string }) => {
    try {
      return { ok: true, removed: deleteArcFieldInfo(payload.fieldId) }
    } catch (error) {
      return dbError(error)
    }
  })

  // batInfo 批次 CRUD（新增/修改走带字段快照的编排方法）
  ipcMain.handle('batInfo:list', () => {
    try {
      return { ok: true, items: listBatInfo() }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'batInfo:create',
    (
      _event,
      payload: {
        arcTypeId: string
        status?: number
        sortNo?: number
        bgColor?: string
        memo?: string
      }
    ) => {
      try {
        return {
          ok: true,
          item: createBatInfoWithSnapshot({
            arcTypeId: payload.arcTypeId,
            status: payload.status,
            sortNo: payload.sortNo,
            bgColor: payload.bgColor,
            memo: payload.memo
          })
        }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle(
    'batInfo:update',
    (
      _event,
      payload: {
        batId: string
        arcTypeId: string
        status?: number
        sortNo?: number
        bgColor?: string
        memo?: string
      }
    ) => {
      try {
        return {
          ok: true,
          item: updateBatInfoWithSnapshot(payload.batId, {
            arcTypeId: payload.arcTypeId,
            status: payload.status,
            sortNo: payload.sortNo,
            bgColor: payload.bgColor,
            memo: payload.memo
          })
        }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('batInfo:delete', (_event, payload: { batId: string }) => {
    try {
      return { ok: true, removed: deleteBatInfo(payload.batId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle('batInfo:get', (_event, payload: { batId: string }) => {
    try {
      return { ok: true, item: getBatInfo(payload.batId) }
    } catch (error) {
      return dbError(error)
    }
  })

  // batArcFieldInfo 批次字段快照 CRUD
  ipcMain.handle('batArcFieldInfo:list', (_event, payload: { batId: string }) => {
    try {
      return { ok: true, items: listBatArcFieldInfo(payload.batId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'batArcFieldInfo:create',
    (
      _event,
      payload: {
        batId: string
        sortNo: number
        fieldName: string
        fieldType: string
        isRequired: number
        memo?: string
      }
    ) => {
      try {
        return { ok: true, item: createBatArcFieldInfo(payload) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle(
    'batArcFieldInfo:update',
    (
      _event,
      payload: {
        id: string
        batId: string
        sortNo: number
        fieldName: string
        fieldType: string
        isRequired: number
        memo?: string
      }
    ) => {
      try {
        const { id, ...input } = payload
        return { ok: true, item: updateBatArcFieldInfo(id, input) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('batArcFieldInfo:delete', (_event, payload: { id: string }) => {
    try {
      return { ok: true, removed: deleteBatArcFieldInfo(payload.id) }
    } catch (error) {
      return dbError(error)
    }
  })

  // ---------- 档案 ----------
  ipcMain.handle('arcInfo:list', (_event, payload: { batId: string }) => {
    try {
      return { ok: true, items: listArcInfo(payload.batId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'arcInfo:create',
    (
      _event,
      payload: { batId: string; arcName: string; sortNo?: number; status?: number; memo?: string }
    ) => {
      try {
        return {
          ok: true,
          item: createArcInfo({
            batId: payload.batId,
            arcName: payload.arcName,
            sortNo: payload.sortNo,
            status: payload.status,
            memo: payload.memo
          })
        }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle(
    'arcInfo:update',
    (
      _event,
      payload: {
        arcId: string
        arcName?: string
        sortNo?: number
        status?: number
        memo?: string
      }
    ) => {
      try {
        const { arcId, ...patch } = payload
        return { ok: true, item: updateArcInfo(arcId, patch) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('arcInfo:delete', (_event, payload: { arcId: string }) => {
    try {
      return { ok: true, removed: deleteArcInfo(payload.arcId) }
    } catch (error) {
      return dbError(error)
    }
  })

  // ---------- 档案图像 ----------
  ipcMain.handle('arcImage:list', (_event, payload: { arcId: string }) => {
    try {
      return { ok: true, items: listArcImage(payload.arcId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle('arcImage:count', (_event, payload: { arcIds: string[] }) => {
    try {
      return { ok: true, items: countArcImageByArcIds(payload.arcIds ?? []) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'arcImage:create-batch',
    (
      _event,
      payload: {
        items: Array<{
          arcId: string
          sortNo: number
          sourcePath: string
          fileName: string
          ext: string
          size?: number
          isPdf?: number
          pdfPageIndex?: number
          pdfPageCount?: number
        }>
      }
    ) => {
      try {
        return { ok: true, items: createArcImageBatch(payload.items ?? []) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle(
    'arcImage:update',
    (
      _event,
      payload: {
        imageId: string
        arcId?: string
        sortNo?: number
        currentHistoryId?: string | null
        rotation?: number
      }
    ) => {
      try {
        const { imageId, ...patch } = payload
        return { ok: true, item: updateArcImage(imageId, patch) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  ipcMain.handle('arcImage:delete', (_event, payload: { imageId: string }) => {
    try {
      return { ok: true, removed: deleteArcImage(payload.imageId) }
    } catch (error) {
      return dbError(error)
    }
  })

  // ---------- OCR 文字识别 ----------
  ipcMain.handle('ocr:recognize-region', async (_event, payload: { dataUrl: string }) => {
    try {
      const result = await recognizeDataUrl(payload.dataUrl)
      return {
        ok: true,
        text: result.lines.map((line) => line.text).join(' '),
        lines: result.lines
      }
    } catch (error) {
      console.error('OCR recognize region failed:', error)
      return { ok: false, message: error instanceof Error ? error.message : 'OCR 识别失败' }
    }
  })

  // ---------- 图像处理历史（临时图像版本） ----------
  ipcMain.handle('arcImageHistory:list', (_event, payload: { imageId: string }) => {
    try {
      return { ok: true, items: listArcImageHistory(payload.imageId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'arcImageHistory:create',
    (
      _event,
      payload: {
        imageId: string
        seqNo: number
        tempRelPath: string
        rotation: number
        actionLabel?: string
      }
    ) => {
      try {
        return { ok: true, item: createArcImageHistory(payload) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  // 撤销后产生新操作：丢弃该版本之后的记录，返回被丢弃的记录（供前端删文件）
  ipcMain.handle(
    'arcImageHistory:truncate',
    (_event, payload: { imageId: string; seqNo: number }) => {
      try {
        return { ok: true, discarded: truncateArcImageHistory(payload.imageId, payload.seqNo) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  // ---------- 档案字段值 ----------
  ipcMain.handle('arcFieldValue:list', (_event, payload: { arcId: string }) => {
    try {
      return { ok: true, items: listArcFieldValue(payload.arcId) }
    } catch (error) {
      return dbError(error)
    }
  })

  ipcMain.handle(
    'arcFieldValue:upsert',
    (
      _event,
      payload: {
        items: Array<{
          arcId: string
          batFieldId: string
          fieldName: string
          fieldValue: string
        }>
      }
    ) => {
      try {
        const saved = (payload.items ?? []).map((item) => upsertArcFieldValue(item))
        return { ok: true, items: saved }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  // 按差异同步档案字段值：仅写入变化项，空值删除已有行
  ipcMain.handle(
    'arcFieldValue:sync',
    (
      _event,
      payload: {
        arcId: string
        items: Array<{ batFieldId: string; fieldName: string; fieldValue: string }>
      }
    ) => {
      try {
        return { ok: true, ...syncArcFieldValue(payload.arcId, payload.items ?? []) }
      } catch (error) {
        return dbError(error)
      }
    }
  )

  // Open a native file dialog and return the selected images as data URLs
  ipcMain.handle('image:open-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择要导入的图片或 PDF',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '图片与 PDF 文件',
          extensions: [...Object.keys(IMAGE_MIME_TYPES), PDF_EXTENSION]
        },
        { name: '图片文件', extensions: Object.keys(IMAGE_MIME_TYPES) },
        { name: 'PDF 文件', extensions: [PDF_EXTENSION] }
      ]
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, images: [] as ImportedImage[], pdfs: [] as PdfSourceFile[] }
    }

    const images: ImportedImage[] = []
    const pdfs: PdfSourceFile[] = []

    for (const filePath of result.filePaths) {
      if (isPdfPath(filePath)) {
        const source = await readPdfSource(filePath)
        if (source) pdfs.push(source)
        continue
      }

      const image = await readImageFile(filePath)
      if (image) images.push(image)
    }

    return { canceled: false, images, pdfs }
  })

  // Open a native folder dialog and return every image inside it as data URLs
  ipcMain.handle('image:open-folder-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择要导入的图片文件夹',
      buttonLabel: '导入',
      properties: ['openDirectory']
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, images: [] as ImportedImage[], pdfs: [] as PdfSourceFile[] }
    }

    const folderPath = result.filePaths[0]

    try {
      const entries = await readdir(folderPath, { withFileTypes: true })
      const filePaths = entries
        .filter((entry) => {
          if (!entry.isFile()) return false
          const ext = extname(entry.name).slice(1).toLowerCase()
          return Boolean(IMAGE_MIME_TYPES[ext]) || ext === PDF_EXTENSION
        })
        .map((entry) => join(folderPath, entry.name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

      const images: ImportedImage[] = []
      const pdfs: PdfSourceFile[] = []

      for (const filePath of filePaths) {
        if (isPdfPath(filePath)) {
          const source = await readPdfSource(filePath)
          if (source) pdfs.push(source)
          continue
        }

        const image = await readImageFile(filePath)
        if (image) images.push(image)
      }

      return { canceled: false, images, pdfs }
    } catch (error) {
      console.error('Failed to read image folder:', folderPath, error)
      return {
        canceled: false,
        images: [] as ImportedImage[],
        pdfs: [] as PdfSourceFile[],
        message: '无法读取该文件夹'
      }
    }
  })

  // Read a PDF file as base64 so the renderer can rasterize its pages
  ipcMain.handle('pdf:read-file', async (_event, payload: { path: string }) => {
    try {
      const filePath = payload.path
      if (!isPdfPath(filePath)) return { ok: false, message: '该文件不是 PDF 文件' }

      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) return { ok: false, message: 'PDF 文件不存在' }
      if (fileStat.size > MAX_PDF_SIZE) {
        return { ok: false, message: 'PDF 文件超过 200 MB，无法导入' }
      }

      const buffer = await readFile(filePath)
      return { ok: true, data: buffer.toString('base64') }
    } catch (error) {
      console.error('Failed to read PDF:', payload.path, error)
      return { ok: false, message: '无法读取该 PDF 文件' }
    }
  })

  // Pick the destination folder used to store the exported PDF files
  ipcMain.handle('pdf:select-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择 PDF 存放位置',
      buttonLabel: '选择此文件夹',
      properties: ['openDirectory', 'createDirectory']
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, dir: '' }
    }

    return { canceled: false, dir: result.filePaths[0] }
  })

  // Render every archive into its own PDF file (no page margins) and report progress
  ipcMain.handle('pdf:export', async (event, payload: PdfExportPayload) => {
    const sender = event.sender
    const archives = payload.archives ?? []
    const silent = payload.silent === true
    const total = archives.length
    const failures: PdfExportFailure[] = []
    const results: PdfExportArchiveResult[] = []
    const usedNames = new Set<string>()
    let done = 0

    try {
      await mkdir(payload.dir, { recursive: true })
    } catch (error) {
      console.error('Failed to create PDF output folder:', payload.dir, error)
      return {
        ok: false,
        total,
        done,
        failed: total,
        failures,
        results,
        message: '目标文件夹不可写'
      }
    }

    for (const archive of archives) {
      if (!silent) {
        sender.send('pdf:export-progress', {
          phase: 'start',
          total,
          done,
          remaining: total - done,
          current: archive.name,
          images: archive.images.length
        })
      }

      const result: PdfExportArchiveResult = {
        name: archive.name,
        fileName: archive.fileName ?? '',
        ok: false,
        used: 0,
        skipped: 0,
        skippedIndexes: [],
        message: ''
      }
      let message = ''

      try {
        // 双层 PDF：先取缓存或识别每张图的文字，再叠加不可见文字层；
        // 只有明确选择双层时才做 OCR，其余情况一律按单层（纯图像）导出
        const textPages: Array<Awaited<ReturnType<typeof recognizeImageWithCache>>['lines']> = []

        if (payload.doubleLayer === true) {
          for (let index = 0; index < archive.images.length; index += 1) {
            const meta = archive.metas?.[index]
            if (!meta?.imageId) {
              textPages.push([])
              continue
            }

            if (!silent) {
              sender.send('pdf:export-progress', {
                phase: 'ocr',
                total,
                done,
                remaining: total - done,
                current: archive.name,
                message: `正在识别文字（${index + 1}/${archive.images.length}）`
              })
            }

            try {
              const recognized = await recognizeImageWithCache(
                meta.imageId,
                meta.historyId ?? '',
                archive.images[index]
              )
              textPages.push(recognized.lines)
            } catch (error) {
              console.error('OCR failed, export image-only page:', archive.name, error)
              textPages.push([])
            }
          }
        }

        const built = await buildPdfFromDataUrls(archive.images, textPages)

        result.used = built.used
        result.skipped = built.skipped
        result.skippedIndexes = built.skippedIndexes

        if (!built.pdf) {
          throw new Error(
            built.skipped ? `${built.skipped} 张图像格式不受支持` : '档案中没有可用的图像'
          )
        }

        let fileName = archive.fileName ?? ''

        if (!fileName) {
          const base = sanitizeFileName(archive.name)
          fileName = base
          let suffix = 2

          while (usedNames.has(fileName.toLowerCase())) {
            fileName = `${base} (${suffix})`
            suffix += 1
          }
        }

        usedNames.add(fileName.toLowerCase())

        await writeFile(join(payload.dir, `${fileName}.pdf`), built.pdf)

        result.fileName = fileName
        result.ok = true

        if (built.skipped) message = `${built.skipped} 张图像无法转换，已跳过`
      } catch (error) {
        console.error('Failed to export PDF:', archive.name, error)
        const reason = error instanceof Error ? error.message : '导出失败'
        failures.push({ name: archive.name, message: reason })
        message = reason
      }

      result.message = message
      results.push(result)
      done += 1

      if (!silent) {
        sender.send('pdf:export-progress', {
          phase: 'file',
          total,
          done,
          remaining: total - done,
          current: archive.name,
          message
        })
      }

      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    if (!silent) {
      sender.send('pdf:export-progress', {
        phase: 'done',
        total,
        done,
        remaining: 0,
        current: '',
        failures: failures.length
      })
    }

    return {
      ok: true,
      dir: payload.dir,
      total,
      done,
      failed: failures.length,
      failures,
      results
    }
  })

  // 导出当前批次全部档案的 Excel（每个档案一行，档案名称 + 批次字段）
  ipcMain.handle(
    'excel:export-archives',
    async (event, payload: ArchiveExcelExportPayload) => {
      try {
        const batch = getBatInfo(payload.batId)
        if (!batch) return { ok: false, message: '批次不存在' }

        const archives = listArcInfo(payload.batId)
        if (!archives.length) return { ok: false, message: '当前批次没有档案' }

        const fields = listBatArcFieldInfo(payload.batId)
        const headers = ['档案名称', ...fields.map((field) => field.fieldName)]
        const rows = archives.map((archive) => {
          const valueMap = new Map(
            listArcFieldValue(archive.arcId).map((item) => [item.batFieldId, item.fieldValue])
          )
          return [archive.arcName, ...fields.map((field) => valueMap.get(field.id) ?? '')]
        })

        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.SaveDialogOptions = {
          title: '导出 Excel',
          defaultPath: `${batch.batCode || '档案信息'}.xlsx`,
          filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
        }
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)

        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true }
        }

        const filePath = /\.xlsx$/i.test(result.filePath)
          ? result.filePath
          : `${result.filePath}.xlsx`

        await writeArchivesExcel(filePath, headers, rows)
        return { ok: true, filePath, count: archives.length }
      } catch (error) {
        console.error('Failed to export archives to Excel:', error)
        return { ok: false, message: '导出 Excel 失败，请稍后重试' }
      }
    }
  )

  // Read the persisted application settings
  ipcMain.handle('settings:get', async () => {
    const settings = await loadSettings()
    return { ...settings }
  })

  // Pick a new temp directory with the native folder dialog and persist it
  ipcMain.handle('settings:select-temp-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择临时文件夹',
      buttonLabel: '使用此文件夹',
      properties: ['openDirectory', 'createDirectory']
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    const current = await loadSettings()

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, settings: { ...current } }
    }

    const next: AppSettings = { ...current, tempDir: result.filePaths[0] }

    try {
      await mkdir(next.tempDir, { recursive: true })
      await saveSettings(next)
    } catch (error) {
      console.error('Failed to use temp dir:', next.tempDir, error)
      return { canceled: false, settings: { ...current }, message: '该文件夹不可写，请重新选择' }
    }

    return { canceled: false, settings: { ...next } }
  })

  // 设置系统默认底色（新增批次时作为批次 bgColor 的默认值）
  ipcMain.handle('settings:set-default-bg-color', async (_event, payload: { color: string }) => {
    const color = normalizeBgColor(payload?.color)
    if (!color) return { ok: false, message: '颜色格式无效，应为 #RRGGBB' }

    try {
      const current = await loadSettings()
      const next: AppSettings = { ...current, defaultBgColor: color }
      await saveSettings(next)
      return { ok: true, settings: { ...next } }
    } catch (error) {
      console.error('Failed to save default bg color:', error)
      return { ok: false, message: '保存默认底色失败' }
    }
  })

  // 本机识别码：主板序列号的 MD5
  ipcMain.handle('settings:machine-code', async () => {
    try {
      return { ok: true, code: await getMachineCode() }
    } catch (error) {
      console.error('Failed to read machine code:', error)
      return { ok: false, message: '无法读取本机识别码' }
    }
  })

  // Open the temp directory in the system file explorer
  ipcMain.handle('settings:open-temp-dir', async () => {
    try {
      const tempDir = await ensureTempDir()
      const error = await shell.openPath(tempDir)
      return { ok: !error, message: error }
    } catch (error) {
      console.error('Failed to open temp dir:', error)
      return { ok: false, message: '无法打开临时文件夹' }
    }
  })

  // Persist a rendered image into the temp directory, under arc/{arcId}/{imageId}/{seqNo}.{ext}
  // 返回相对临时目录的路径（写入数据库的就是这个相对路径）
  ipcMain.handle(
    'image:save-temp',
    async (
      _event,
      payload: { arcId: string; imageId: string; seqNo: number; dataUrl: string }
    ) => {
      try {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(payload.dataUrl)
        if (!match) return { ok: false, message: '图片数据格式无效' }

        const ext = MIME_TO_EXT[match[1]] ?? 'png'
        const safeArc = payload.arcId.replace(/[^a-zA-Z0-9_-]/g, '') || 'arc'
        const safeImage = payload.imageId.replace(/[^a-zA-Z0-9_-]/g, '') || 'image'
        const seqNo = Number.isFinite(payload.seqNo) ? payload.seqNo : 0

        const tempDir = await ensureTempDir()
        const relPath = ['arc', safeArc, safeImage, `${seqNo}.${ext}`].join('/')
        const filePath = join(tempDir, 'arc', safeArc, safeImage, `${seqNo}.${ext}`)

        await mkdir(join(tempDir, 'arc', safeArc, safeImage), { recursive: true })
        await writeFile(filePath, Buffer.from(match[2], 'base64'))

        return { ok: true, relPath }
      } catch (error) {
        console.error('Failed to save temp image:', error)
        return { ok: false, message: '写入临时文件夹失败' }
      }
    }
  )

  // 去黑边：扫描件边缘的黑边用批次底色填充，保持图像尺寸不变
  ipcMain.handle(
    'image:clean-border',
    async (_event, payload: { dataUrl: string; bgColor?: string }) => {
      try {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(payload.dataUrl)
        if (!match) return { ok: false, message: '图片数据格式无效' }

        const hex = /^#?([0-9a-fA-F]{6})$/.exec(payload.bgColor?.trim() ?? '')
        const hexValue = hex ? hex[1] : 'FFFFFF'
        const fill = {
          r: parseInt(hexValue.slice(0, 2), 16),
          g: parseInt(hexValue.slice(2, 4), 16),
          b: parseInt(hexValue.slice(4, 6), 16)
        }

        // 转成 RGB 原始像素，便于逐像素清理边缘黑边
        const { data, info } = await sharp(Buffer.from(match[2], 'base64'))
          .rotate()
          .flatten({ background: `#${hexValue}` })
          .toColourspace('srgb')
          .raw()
          .toBuffer({ resolveWithObject: true })

        const { width, height, channels } = info

        // 用亮度判定：黑边常带抗锯齿灰边，单通道硬阈值会漏掉大量灰边
        const isDark = (x: number, y: number): boolean => {
          const i = (y * width + x) * channels
          const luminance =
            channels >= 3
              ? 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
              : data[i]
          return luminance <= BORDER_DARK_THRESHOLD
        }

        const rangeX = Math.max(4, Math.round(width * BORDER_CLEAN_RANGE_RATIO))
        const rangeY = Math.max(4, Math.round(height * BORDER_CLEAN_RANGE_RATIO))
        const gapX = Math.min(rangeX, 32, Math.max(8, Math.round(width * BORDER_CLEAN_GAP_RATIO)))
        const gapY = Math.min(rangeY, 32, Math.max(8, Math.round(height * BORDER_CLEAN_GAP_RATIO)))

        // 从一条扫描线的一端向内测黑边厚度：先跳过外侧白边，再吃掉一段暗像素（含断点）
        const measureThickness = (
          range: number,
          gap: number,
          darkAt: (offset: number) => boolean
        ): number => {
          let start = -1
          for (let offset = 0; offset < gap && start < 0; offset += 1) {
            if (darkAt(offset)) start = offset
          }
          if (start < 0) return 0

          let end = start
          let holes = 0
          while (end < range) {
            if (darkAt(end)) {
              holes = 0
            } else if (holes >= BORDER_CLEAN_HOLE_TOLERANCE) {
              break
            } else {
              holes += 1
            }
            end += 1
          }

          // 触及扫描上限说明是连续暗区而非细黑边，交给其他方向或保持原样
          const thickness = end + BORDER_CLEAN_FEATHER
          return thickness >= range ? 0 : thickness
        }

        // 断续黑线会在断点处留下缺口，用两侧邻近行的厚度补齐
        const closeGaps = (profile: Uint16Array): void => {
          const radius = 8
          const source = Uint16Array.from(profile)
          for (let i = 0; i < source.length; i += 1) {
            if (source[i]) continue
            let before = 0
            let after = 0
            for (let k = 1; k <= radius; k += 1) {
              if (!before && i - k >= 0) before = source[i - k]
              if (!after && i + k < source.length) after = source[i + k]
            }
            if (before && after) profile[i] = Math.min(before, after)
          }
        }

        const leftProfile = new Uint16Array(height)
        const rightProfile = new Uint16Array(height)
        for (let y = 0; y < height; y += 1) {
          leftProfile[y] = measureThickness(rangeX, gapX, (offset) => isDark(offset, y))
          rightProfile[y] = measureThickness(rangeX, gapX, (offset) =>
            isDark(width - 1 - offset, y)
          )
        }
        closeGaps(leftProfile)
        closeGaps(rightProfile)

        const topProfile = new Uint16Array(width)
        const bottomProfile = new Uint16Array(width)
        for (let x = 0; x < width; x += 1) {
          topProfile[x] = measureThickness(rangeY, gapY, (offset) => isDark(x, offset))
          bottomProfile[x] = measureThickness(rangeY, gapY, (offset) =>
            isDark(x, height - 1 - offset)
          )
        }
        closeGaps(topProfile)
        closeGaps(bottomProfile)

        const detected = [topProfile, bottomProfile, leftProfile, rightProfile].some((profile) =>
          profile.some((value) => value > 0)
        )

        if (!detected) {
          return { ok: false, message: '未检测到需要清理的黑边' }
        }

        const setFill = (x: number, y: number): void => {
          const i = (y * width + x) * channels
          data[i] = fill.r
          if (channels >= 3) {
            data[i + 1] = fill.g
            data[i + 2] = fill.b
          }
        }

        for (let x = 0; x < width; x += 1) {
          const top = topProfile[x]
          for (let y = 0; y < top; y += 1) setFill(x, y)
          const bottom = bottomProfile[x]
          for (let y = height - bottom; y < height; y += 1) setFill(x, y)
        }

        for (let y = 0; y < height; y += 1) {
          const left = leftProfile[y]
          for (let x = 0; x < left; x += 1) setFill(x, y)
          const right = rightProfile[y]
          for (let x = Math.max(width - right, left); x < width; x += 1) setFill(x, y)
        }

        const output = await sharp(data, { raw: { width, height, channels } }).png().toBuffer()

        return {
          ok: true,
          dataUrl: `data:image/png;base64,${output.toString('base64')}`
        }
      } catch (error) {
        console.error('Failed to clean image border:', error)
        return { ok: false, message: '去黑边失败' }
      }
    }
  )

  // Read an original image file back as a data URL (for restoring images from database)
  ipcMain.handle('image:read-file', async (_event, payload: { path: string }) => {
    try {
      const ext = extname(payload.path).slice(1).toLowerCase()
      const mime = IMAGE_MIME_TYPES[ext]
      if (!mime) return { ok: false, message: '不支持的图像格式' }

      const buffer = await readFile(payload.path)
      return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
    } catch (error) {
      console.error('Failed to read image file:', error)
      return { ok: false, message: '读取原始图像失败' }
    }
  })

  // Read a previously persisted temp image back as a data URL (for history restore)
  ipcMain.handle('image:read-temp', async (_event, payload: { path: string }) => {
    try {
      const filePath = await resolveTempPath(payload.path)
      if (!filePath) return { ok: false, message: '临时文件路径无效' }

      const buffer = await readFile(filePath)
      const ext = extname(filePath).slice(1).toLowerCase()
      const mime = IMAGE_MIME_TYPES[ext] ?? 'image/png'

      return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
    } catch (error) {
      console.error('Failed to read temp image:', error)
      return { ok: false, message: '读取临时文件失败' }
    }
  })

  // Remove temp files that fell out of an image's history (undo/redo truncation)
  ipcMain.handle('image:delete-temp', async (_event, payload: { paths: string[] }) => {
    let removed = 0

    for (const target of payload.paths ?? []) {
      try {
        const filePath = await resolveTempPath(target)
        if (!filePath) continue
        await unlink(filePath)
        removed += 1
      } catch {
        continue
      }
    }

    return { ok: true, removed }
  })

  // 读取图像位深度：绝对路径为原始文件，相对路径为临时文件
  ipcMain.handle('image:bit-depth', async (_event, payload: { path: string }) => {
    try {
      const target = isAbsolute(payload.path) ? payload.path : await resolveTempPath(payload.path)
      if (!target) return { ok: false, message: '图像路径无效' }

      const info = await detectImageBitDepth(target)
      if (!info) return { ok: false, message: '无法识别图像位深度' }

      return { ok: true, depth: info.depth, colorMode: info.colorMode }
    } catch (error) {
      console.error('Failed to read image bit depth:', error)
      return { ok: false, message: '读取图像位深度失败' }
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  shutdownOcrWorker()
  closeDatabase()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
