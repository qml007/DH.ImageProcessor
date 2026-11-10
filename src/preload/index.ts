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