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

export interface SystemConfigRow {
  configKey: string
  configValue: string
  memo: string
}

export interface DatabaseInfoResult {
  ok: boolean
  path: string
  message?: string
}

export interface ConfigListResult {
  ok: boolean
  items?: SystemConfigRow[]
  message?: string
}

export interface ConfigGetPayload {
  configKey: string
}

export interface ConfigGetResult {
  ok: boolean
  item?: SystemConfigRow | null
  message?: string
}

export interface ConfigSetPayload {
  configKey: string
  configValue: string
  memo?: string
}

export interface ConfigSetResult {
  ok: boolean
  message?: string
}

export interface ConfigDeletePayload {
  configKey: string
}

export interface ConfigDeleteResult {
  ok: boolean
  removed?: number
  message?: string
}

// ---------- arcType 档案类型 ----------

export interface ArcTypeRow {
  typeId: string
  arcTypeCode: string
  arcTypeName: string
  statusFlag: number
  memo: string
}

export interface ArcTypeListPayload {
  includeDisabled?: boolean
}

export interface ArcTypeListResult {
  ok: boolean
  items?: ArcTypeRow[]
  message?: string
}

export interface ArcTypeGetPayload {
  typeId: string
}

export interface ArcTypeGetResult {
  ok: boolean
  item?: ArcTypeRow | null
  message?: string
}

export interface ArcTypeSavePayload {
  arcTypeCode: string
  arcTypeName: string
  statusFlag: number
  memo?: string
}

export interface ArcTypeCreateResult {
  ok: boolean
  item?: ArcTypeRow
  message?: string
}

export interface ArcTypeUpdatePayload extends ArcTypeSavePayload {
  typeId: string
}

export interface ArcTypeUpdateResult {
  ok: boolean
  item?: ArcTypeRow | null
  message?: string
}

export interface ArcTypeDeletePayload {
  typeId: string
}

export interface ArcTypeDeleteResult {
  ok: boolean
  removed?: number
  message?: string
}

// ---------- arcFieldInfo 档案类型字段 ----------

export interface ArcFieldInfoRow {
  fieldId: string
  arcTypeId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo: string
}

export interface ArcFieldInfoListPayload {
  arcTypeId: string
}

export interface ArcFieldInfoListResult {
  ok: boolean
  items?: ArcFieldInfoRow[]
  message?: string
}

export interface ArcFieldInfoSavePayload {
  arcTypeId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo?: string
}

export interface ArcFieldInfoCreateResult {
  ok: boolean
  item?: ArcFieldInfoRow
  message?: string
}

export interface ArcFieldInfoUpdatePayload extends ArcFieldInfoSavePayload {
  fieldId: string
}

export interface ArcFieldInfoUpdateResult {
  ok: boolean
  item?: ArcFieldInfoRow | null
  message?: string
}

export interface ArcFieldInfoDeletePayload {
  fieldId: string
}

export interface ArcFieldInfoDeleteResult {
  ok: boolean
  removed?: number
  message?: string
}

// ---------- batInfo 批次 ----------

export interface BatInfoRow {
  batId: string
  batCode: string
  arcTypeId: string
  arcTypeName: string
  timeOfCreate: string
  status: number
  sortNo: number
  memo: string
}

export interface BatInfoListResult {
  ok: boolean
  items?: BatInfoRow[]
  message?: string
}

export interface BatInfoSavePayload {
  arcTypeId: string
  status?: number
  sortNo?: number
  memo?: string
}

export interface BatInfoUpdatePayload extends BatInfoSavePayload {
  batId: string
}

export interface BatInfoSaveResult {
  ok: boolean
  item?: BatInfoRow | null
  message?: string
}

export interface BatInfoDeletePayload {
  batId: string
}

export interface BatInfoDeleteResult {
  ok: boolean
  removed?: number
  message?: string
}

export interface BatInfoGetPayload {
  batId: string
}

export interface BatInfoGetResult {
  ok: boolean
  item?: BatInfoRow | null
  message?: string
}

// ---------- batArcFieldInfo 批次字段快照 ----------

export interface BatArcFieldInfoRow {
  id: string
  batId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo: string
}

export interface BatArcFieldInfoListPayload {
  batId: string
}

export interface BatArcFieldInfoListResult {
  ok: boolean
  items?: BatArcFieldInfoRow[]
  message?: string
}

export interface BatArcFieldInfoSavePayload {
  batId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo?: string
}

export interface BatArcFieldInfoUpdatePayload extends BatArcFieldInfoSavePayload {
  id: string
}

export interface BatArcFieldInfoSaveResult {
  ok: boolean
  item?: BatArcFieldInfoRow | null
  message?: string
}

export interface BatArcFieldInfoDeletePayload {
  id: string
}

export interface BatArcFieldInfoDeleteResult {
  ok: boolean
  removed?: number
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
  getDatabaseInfo: () => Promise<DatabaseInfoResult>
  listConfig: () => Promise<ConfigListResult>
  getConfig: (payload: ConfigGetPayload) => Promise<ConfigGetResult>
  setConfig: (payload: ConfigSetPayload) => Promise<ConfigSetResult>
  deleteConfig: (payload: ConfigDeletePayload) => Promise<ConfigDeleteResult>
  listArcType: (payload?: ArcTypeListPayload) => Promise<ArcTypeListResult>
  getArcType: (payload: ArcTypeGetPayload) => Promise<ArcTypeGetResult>
  createArcType: (payload: ArcTypeSavePayload) => Promise<ArcTypeCreateResult>
  updateArcType: (payload: ArcTypeUpdatePayload) => Promise<ArcTypeUpdateResult>
  deleteArcType: (payload: ArcTypeDeletePayload) => Promise<ArcTypeDeleteResult>
  listArcFieldInfo: (payload: ArcFieldInfoListPayload) => Promise<ArcFieldInfoListResult>
  createArcFieldInfo: (payload: ArcFieldInfoSavePayload) => Promise<ArcFieldInfoCreateResult>
  updateArcFieldInfo: (payload: ArcFieldInfoUpdatePayload) => Promise<ArcFieldInfoUpdateResult>
  deleteArcFieldInfo: (payload: ArcFieldInfoDeletePayload) => Promise<ArcFieldInfoDeleteResult>
  listBatInfo: () => Promise<BatInfoListResult>
  createBatInfo: (payload: BatInfoSavePayload) => Promise<BatInfoSaveResult>
  updateBatInfo: (payload: BatInfoUpdatePayload) => Promise<BatInfoSaveResult>
  deleteBatInfo: (payload: BatInfoDeletePayload) => Promise<BatInfoDeleteResult>
  getBatInfo: (payload: BatInfoGetPayload) => Promise<BatInfoGetResult>
  listBatArcFieldInfo: (payload: BatArcFieldInfoListPayload) => Promise<BatArcFieldInfoListResult>
  createBatArcFieldInfo: (payload: BatArcFieldInfoSavePayload) => Promise<BatArcFieldInfoSaveResult>
  updateBatArcFieldInfo: (
    payload: BatArcFieldInfoUpdatePayload
  ) => Promise<BatArcFieldInfoSaveResult>
  deleteBatArcFieldInfo: (
    payload: BatArcFieldInfoDeletePayload
  ) => Promise<BatArcFieldInfoDeleteResult>
  onPdfExportProgress: (callback: (progress: PdfExportProgress) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}