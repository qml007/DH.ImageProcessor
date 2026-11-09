import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { basename, extname, isAbsolute, join, relative, resolve } from 'path'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/dh.png?asset'
import { buildPdfFromDataUrls } from './pdf'

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

interface ImportedImage {
  path: string
  name: string
  ext: string
  size: number
  dataUrl: string
}

interface AppSettings {
  tempDir: string
}

interface PdfExportArchive {
  name: string
  images: string[]
  fileName?: string
}

interface PdfExportPayload {
  dir: string
  archives: PdfExportArchive[]
  silent?: boolean
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

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultTempDir(): string {
  return join(app.getPath('temp'), 'electron-admin-images')
}

async function loadSettings(): Promise<AppSettings> {
  if (settingsCache) return settingsCache

  const fallback: AppSettings = { tempDir: defaultTempDir() }

  try {
    const raw = await readFile(settingsFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    settingsCache = { tempDir: parsed.tempDir?.trim() || fallback.tempDir }
  } catch {
    settingsCache = fallback
  }

  return settingsCache
}

async function saveSettings(next: AppSettings): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsFilePath(), JSON.stringify(next, null, 2), 'utf-8')
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
  const full = resolve(target)
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

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Open a native file dialog and return the selected images as data URLs
  ipcMain.handle('image:open-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择要导入的图片',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '图片文件',
          extensions: Object.keys(IMAGE_MIME_TYPES)
        }
      ]
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, images: [] as ImportedImage[] }
    }

    const images = (await Promise.all(result.filePaths.map(readImageFile))).filter(
      (item): item is ImportedImage => item !== null
    )

    return { canceled: false, images }
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
      return { canceled: true, images: [] as ImportedImage[] }
    }

    const folderPath = result.filePaths[0]

    try {
      const entries = await readdir(folderPath, { withFileTypes: true })
      const filePaths = entries
        .filter(
          (entry) => entry.isFile() && IMAGE_MIME_TYPES[extname(entry.name).slice(1).toLowerCase()]
        )
        .map((entry) => join(folderPath, entry.name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

      const images = (await Promise.all(filePaths.map(readImageFile))).filter(
        (item): item is ImportedImage => item !== null
      )

      return { canceled: false, images }
    } catch (error) {
      console.error('Failed to read image folder:', folderPath, error)
      return { canceled: false, images: [] as ImportedImage[], message: '无法读取该文件夹' }
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
        const built = buildPdfFromDataUrls(archive.images)

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

  // Persist a rendered image (e.g. after rotation) into the temp directory
  ipcMain.handle(
    'image:save-temp',
    async (_event, payload: { id: string; dataUrl: string; slot?: string }) => {
      try {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(payload.dataUrl)
        if (!match) return { ok: false, message: '图片数据格式无效' }

        const ext = MIME_TO_EXT[match[1]] ?? 'png'
        const safeId = payload.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'image'
        const safeSlot = (payload.slot ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
        const fileName = safeSlot ? `${safeId}-${safeSlot}.${ext}` : `${safeId}.${ext}`

        const tempDir = await ensureTempDir()
        const filePath = join(tempDir, fileName)

        await writeFile(filePath, Buffer.from(match[2], 'base64'))

        return { ok: true, path: filePath }
      } catch (error) {
        console.error('Failed to save temp image:', error)
        return { ok: false, message: '写入临时文件夹失败' }
      }
    }
  )

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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.