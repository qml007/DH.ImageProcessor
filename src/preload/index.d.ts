import { ElectronAPI } from '@electron-toolkit/preload'

export interface ImportedImage {
  path: string
  name: string
  ext: string
  size: number
  dataUrl: string
}

export interface PdfSourceFile {
  path: string
  name: string
  size: number
}

export interface OpenImagesResult {
  canceled: boolean
  images: ImportedImage[]
  pdfs?: PdfSourceFile[]
  message?: string
}

export interface ReadPdfFilePayload {
  path: string
}

export interface ReadPdfFileResult {
  ok: boolean
  data?: string
  message?: string
}

export interface AppSettings {
  tempDir: string
}

export interface SelectTempDirResult {
  canceled: boolean
  settings: AppSettings
  message?: string
}

export interface OpenTempDirResult {
  ok: boolean
  message: string
}

export interface SaveTempImagePayload {
  id: string
  dataUrl: string
  slot?: string
}

export interface SaveTempImageResult {
  ok: boolean
  path?: string
  message?: string
}

export interface ReadTempImagePayload {
  path: string
}

export interface ReadTempImageResult {
  ok: boolean
  dataUrl?: string
  message?: string
}

export interface DeleteTempImagesPayload {
  paths: string[]
}

export interface DeleteTempImagesResult {
  ok: boolean
  removed: number
}

export interface SelectPdfFolderResult {
  canceled: boolean
  dir: string
}

export interface PdfExportArchive {
  name: string
  images: string[]
  fileName?: string
}

export interface PdfExportPayload {
  dir: string
  archives: PdfExportArchive[]
  silent?: boolean
}

export interface PdfExportProgress {
  phase: 'start' | 'file' | 'done'
  total: number
  done: number
  remaining: number
  current: string
  images?: number
  message?: string
  failures?: number
}

export interface PdfExportFailure {
  name: string
  message: string
}

export interface PdfExportArchiveResult {
  name: string
  fileName: string
  ok: boolean
  used: number
  skipped: number
  skippedIndexes: number[]
  message: string
}

export interface PdfExportResult {
  ok: boolean
  dir?: string
  total: number
  done: number
  failed: number
  failures: PdfExportFailure[]
  results: PdfExportArchiveResult[]
  message?: string
}

export interface RendererApi {
  openImages: () => Promise<OpenImagesResult>
  openImageFolder: () => Promise<OpenImagesResult>
  readPdfFile: (payload: ReadPdfFilePayload) => Promise<ReadPdfFileResult>
  getSettings: () => Promise<AppSettings>
  selectTempDir: () => Promise<SelectTempDirResult>
  openTempDir: () => Promise<OpenTempDirResult>
  saveTempImage: (payload: SaveTempImagePayload) => Promise<SaveTempImageResult>
  readTempImage: (payload: ReadTempImagePayload) => Promise<ReadTempImageResult>
  deleteTempImages: (payload: DeleteTempImagesPayload) => Promise<DeleteTempImagesResult>
  selectPdfFolder: () => Promise<SelectPdfFolderResult>
  exportPdf: (payload: PdfExportPayload) => Promise<PdfExportResult>
  onPdfExportProgress: (callback: (progress: PdfExportProgress) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}