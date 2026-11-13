import { app, shell, BrowserWindow, ipcMain, dialog, net, protocol } from 'electron'
import { basename, extname, isAbsolute, join, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/dh.png?asset'
import { buildPdfFromDataUrls } from './pdf'
import { recognizeDataUrl, recognizeImageWithCache, shutdownOcrWorker } from './ocr'
import {
  closeDatabase,
  countArcImageByArcIds,
  createArcFieldInfo,
  createArcImageBatch,
  createArcImageHistory,
  createArcInfo,
  createArcType,
  createBatArcFieldInfo,
  createBatInfoWithSnapshot,
  deleteArcFieldInfo,
  deleteArcImage,
  deleteArcInfo,
  deleteArcType,
  deleteBatArcFieldInfo,
  deleteBatInfo,
  deleteConfig,
  getArcType,
  getBatInfo,
  getConfig,
  initializeDatabase,
  listArcFieldValue,
  listArcFieldInfo,
  listArcImage,
  listArcImageHistory,
  listArcInfo,
  listArcType,
  listBatArcFieldInfo,
  listBatInfo,
  listConfig,
  setConfig,
  truncateArcImageHistory,
  updateArcFieldInfo,
  updateArcImage,
  updateArcInfo,
  updateArcType,
  updateBatArcFieldInfo,
  updateBatInfoWithSnapshot,
  upsertArcFieldValue
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

  const fallback: AppSettings = { tempDir: defaultTempDir() }

  try {
    const row = getConfig(TEMP_DIR_CONFIG_KEY)
    settingsCache = { tempDir: row?.configValue.trim() || fallback.tempDir }
  } catch (error) {
    console.error('Failed to read temp dir setting from database:', error)
    settingsCache = fallback
  }

  return settingsCache
}

async function saveSettings(next: AppSettings): Promise<void> {
  setConfig(TEMP_DIR_CONFIG_KEY, next.tempDir, '临时文件夹路径')
  settingsCache = next
}

async function ensureTempDir(): Promise<string> {
  const { tempDir } = await loadSettings()
  await mkdir(tempDir, { recursive: true })
  return tempDir
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
    (_event, payload: { arcTypeId: string; status?: number; sortNo?: number; memo?: string }) => {
      try {
        return {
          ok: true,
          item: createBatInfoWithSnapshot({
            arcTypeId: payload.arcTypeId,
            status: payload.status,
            sortNo: payload.sortNo,
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
      payload: { batId: string; arcTypeId: string; status?: number; sortNo?: number; memo?: string }
    ) => {
      try {
        return {
          ok: true,
          item: updateBatInfoWithSnapshot(payload.batId, {
            arcTypeId: payload.arcTypeId,
            status: payload.status,
            sortNo: payload.sortNo,
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

    const next: AppSettings = { tempDir: result.filePaths[0] }

    try {
      await mkdir(next.tempDir, { recursive: true })
      await saveSettings(next)
    } catch (error) {
      console.error('Failed to use temp dir:', next.tempDir, error)
      return { canceled: false, settings: { ...current }, message: '该文件夹不可写，请重新选择' }
    }

    return { canceled: false, settings: { ...next } }
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
