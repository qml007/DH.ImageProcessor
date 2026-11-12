import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openImages: (): Promise<unknown> => ipcRenderer.invoke('image:open-dialog'),
  openImageFolder: (): Promise<unknown> => ipcRenderer.invoke('image:open-folder-dialog'),
  readPdfFile: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('pdf:read-file', payload),
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),
  selectTempDir: (): Promise<unknown> => ipcRenderer.invoke('settings:select-temp-dir'),
  openTempDir: (): Promise<unknown> => ipcRenderer.invoke('settings:open-temp-dir'),
  saveTempImage: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('image:save-temp', payload),
  readImageFile: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('image:read-file', payload),
  readTempImage: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('image:read-temp', payload),
  deleteTempImages: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('image:delete-temp', payload),
  selectPdfFolder: (): Promise<unknown> => ipcRenderer.invoke('pdf:select-folder'),
  exportPdf: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('pdf:export', payload),
  getDatabaseInfo: (): Promise<unknown> => ipcRenderer.invoke('db:info'),
  listConfig: (): Promise<unknown> => ipcRenderer.invoke('db:config-list'),
  getConfig: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('db:config-get', payload),
  setConfig: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('db:config-set', payload),
  deleteConfig: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('db:config-delete', payload),

  // arcType 档案类型 CRUD
  listArcType: (payload?: unknown): Promise<unknown> => ipcRenderer.invoke('arcType:list', payload),
  getArcType: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('arcType:get', payload),
  createArcType: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcType:create', payload),
  updateArcType: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcType:update', payload),
  deleteArcType: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcType:delete', payload),

  // arcFieldInfo 档案类型字段 CRUD
  listArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcFieldInfo:list', payload),
  createArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcFieldInfo:create', payload),
  updateArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcFieldInfo:update', payload),
  deleteArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcFieldInfo:delete', payload),

  // batInfo 批次 CRUD
  listBatInfo: (): Promise<unknown> => ipcRenderer.invoke('batInfo:list'),
  createBatInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batInfo:create', payload),
  updateBatInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batInfo:update', payload),
  deleteBatInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batInfo:delete', payload),
  getBatInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batInfo:get', payload),

  // batArcFieldInfo 批次字段快照 CRUD
  listBatArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batArcFieldInfo:list', payload),
  createBatArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batArcFieldInfo:create', payload),
  updateBatArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batArcFieldInfo:update', payload),
  deleteBatArcFieldInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('batArcFieldInfo:delete', payload),

  // arcInfo 档案
  listArcInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcInfo:list', payload),
  createArcInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcInfo:create', payload),
  updateArcInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcInfo:update', payload),
  deleteArcInfo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcInfo:delete', payload),

  // arcImage 档案图像
  listArcImage: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImage:list', payload),
  countArcImage: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImage:count', payload),
  createArcImageBatch: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImage:create-batch', payload),
  updateArcImage: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImage:update', payload),
  deleteArcImage: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImage:delete', payload),

  // arcImageHistory 图像处理历史
  listArcImageHistory: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImageHistory:list', payload),
  createArcImageHistory: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImageHistory:create', payload),
  truncateArcImageHistory: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcImageHistory:truncate', payload),

  // arcFieldValue 档案字段值
  listArcFieldValue: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcFieldValue:list', payload),
  upsertArcFieldValue: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('arcFieldValue:upsert', payload),

  // OCR 文字识别
  recognizeRegion: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('ocr:recognize-region', payload),

  onPdfExportProgress: (callback: (progress: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown): void =>
      callback(progress)

    ipcRenderer.on('pdf:export-progress', listener)
    return () => {
      ipcRenderer.removeListener('pdf:export-progress', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}