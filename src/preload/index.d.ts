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
  defaultBgColor: string
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

export interface MachineCodeResult {
  ok: boolean
  code?: string
  message?: string
}

export interface SetDefaultBgColorPayload {
  color: string
}

export interface SetDefaultBgColorResult {
  ok: boolean
  settings?: AppSettings
  message?: string
}

export interface ArchiveExcelExportPayload {
  batId: string
}

export interface ArchiveExcelExportResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  count?: number
  message?: string
}

export interface SaveTempImagePayload {
  arcId: string
  imageId: string
  seqNo: number
  dataUrl: string
}

export interface SaveTempImageResult {
  ok: boolean
  /** 相对于临时文件夹的路径，如 arc/{arcId}/{imageId}/{seqNo}.png */
  relPath?: string
  message?: string
}

export interface ReadImageFilePayload {
  path: string
}

export interface CleanImageBorderPayload {
  dataUrl: string
  /** 填充用的批次底色，如 #FFFFFF */
  bgColor?: string
}

export interface CleanImageBorderResult {
  ok: boolean
  /** 清理后的 PNG data URL（尺寸不变） */
  dataUrl?: string
  message?: string
}

export interface ReadImageFileResult {
  ok: boolean
  dataUrl?: string
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

export interface ImageBitDepthPayload {
  path: string
}

export interface ImageBitDepthResult {
  ok: boolean
  /** 每像素总位数，如 RGB 为 24 */
  depth?: number
  /** 颜色模式，如 RGB / RGBA / 索引 */
  colorMode?: string
  message?: string
}

export interface SelectPdfFolderResult {
  canceled: boolean
  dir: string
}

export interface OpenPdfFolderPayload {
  dir: string
}

export interface OpenPdfFolderResult {
  ok: boolean
  message?: string
}

export interface PdfExportArchive {
  name: string
  images: string[]
  fileName?: string
  /** 与 images 一一对应的图像版本信息，用于双层 PDF 的 OCR 缓存 */
  metas?: Array<{ imageId: string; historyId: string }>
}

export interface PdfExportPayload {
  dir: string
  archives: PdfExportArchive[]
  silent?: boolean
  /** 仅当为 true 时生成双层 PDF（先 OCR 并叠加文字层），否则按单层纯图像 PDF 导出 */
  doubleLayer?: boolean
}

export interface PdfExportProgress {
  phase: 'start' | 'ocr' | 'file' | 'done'
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

// ---------- OCR 文字识别 ----------

export interface OcrLine {
  text: string
  score: number
  x: number
  y: number
  width: number
  height: number
}

export interface OcrRecognizeRegionPayload {
  dataUrl: string
}

export interface OcrRecognizeRegionResult {
  ok: boolean
  text?: string
  lines?: OcrLine[]
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

// ---------- 设置 · AI 服务 AISettingInfo ----------

export type AiAdvancedParamType = 'text' | 'number' | 'boolean'

export interface AiAdvancedParam {
  key: string
  type: AiAdvancedParamType
  value: string
}

export interface AiSettingInfoRow {
  aiId: string
  name: string
  protocol: string
  baseUrl: string
  model: string
  supportsVision: number
  isDefault: number
  advancedParams: AiAdvancedParam[]
  sortNo: number
  timeOfCreate: string
  timeOfUpdate: string
  /** 掩码后的密钥，完整密钥不返回渲染进程 */
  apiKeyMasked: string
  hasApiKey: number
}

export interface AiSettingInfoListResult {
  ok: boolean
  items?: AiSettingInfoRow[]
  message?: string
}

export interface AiSettingInfoSavePayload {
  name: string
  protocol: string
  baseUrl: string
  apiKey?: string
  model: string
  supportsVision: number
  advancedParams: AiAdvancedParam[]
  sortNo?: number
}

export interface AiSettingInfoUpdatePayload extends Omit<AiSettingInfoSavePayload, 'name'> {
  aiId: string
}

export interface AiSettingInfoSaveResult {
  ok: boolean
  item?: AiSettingInfoRow
  message?: string
}

export interface AiSettingInfoDeletePayload {
  aiId: string
}

export interface AiSettingInfoDeleteResult {
  ok: boolean
  removed?: number
  message?: string
}

export interface AiSettingInfoTestPayload {
  aiId?: string
  baseUrl: string
  apiKey?: string
  model: string
  supportsVision: number
  advancedParams: AiAdvancedParam[]
}

export interface AiSettingInfoTestResult {
  ok: boolean
  message: string
  latencyMs: number
  model?: string
  vision: 'supported' | 'unsupported' | 'not-tested'
}

// ---------- AI 对话 ----------

export type AiChatRole = 'user' | 'assistant' | 'system'

export interface AiChatMessage {
  role: AiChatRole
  content: string
  /** data:image/...;base64,... 形式的图片 */
  images?: string[]
}

export interface AiChatStartPayload {
  requestId: string
  aiId: string
  messages: AiChatMessage[]
}

export interface AiChatStartResult {
  ok: boolean
  message?: string
}

export interface AiChatEvent {
  requestId: string
  type: 'delta' | 'done' | 'error'
  delta?: string
  message?: string
  aborted?: boolean
}

export interface AiChatImagePayload {
  dataUrl: string
}

export interface AiChatImageResult {
  ok: boolean
  /** 相对于临时文件夹的路径，如 ai-chat/xxx.png */
  relPath?: string
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
  bgColor: string
  /** 档案名称位数，默认 4 */
  arcNameLen: number
  /** 档案名称前缀，导出时拼接在档案名称前 */
  arcNamePreStr: string
  memo: string
  /** 该批次包含的档案数量 */
  arcCount: number
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
  bgColor?: string
  /** 默认 4 */
  arcNameLen?: number
  /** 默认空字符串 */
  arcNamePreStr?: string
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
  defaultValue: string
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
  defaultValue?: string
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

// ---------- 档案 arcInfo ----------

export interface ArcInfoRow {
  arcId: string
  batId: string
  arcName: string
  sortNo: number
  status: number
  timeOfCreate: string
  memo: string
}

export interface ArcInfoListPayload {
  batId: string
}

export interface ArcInfoListResult {
  ok: boolean
  items?: ArcInfoRow[]
  message?: string
}

export interface ArcInfoSavePayload {
  batId: string
  arcName: string
  sortNo?: number
  status?: number
  memo?: string
}

export interface ArcInfoUpdatePayload {
  arcId: string
  arcName?: string
  sortNo?: number
  status?: number
  memo?: string
}

export interface ArcInfoSaveResult {
  ok: boolean
  item?: ArcInfoRow | null
  message?: string
}

export interface ArcInfoDeletePayload {
  arcId: string
}

export interface ArcInfoDeleteResult {
  ok: boolean
  removed?: number
  message?: string
}

// ---------- 档案图像 arcImage ----------

export interface ArcImageRow {
  imageId: string
  arcId: string
  sortNo: number
  sourcePath: string
  fileName: string
  ext: string
  size: number
  isPdf: number
  pdfPageIndex: number
  pdfPageCount: number
  currentHistoryId: string
  rotation: number
  timeOfCreate: string
}

export interface ArcImageInput {
  arcId: string
  sortNo: number
  sourcePath: string
  fileName: string
  ext: string
  size?: number
  isPdf?: number
  pdfPageIndex?: number
  pdfPageCount?: number
}

export interface ArcImageListPayload {
  arcId: string
}

export interface ArcImageListResult {
  ok: boolean
  items?: ArcImageRow[]
  message?: string
}

export interface ArcImageCountPayload {
  arcIds: string[]
}

export interface ArcImageCountRow {
  arcId: string
  count: number
}

export interface ArcImageCountResult {
  ok: boolean
  items?: ArcImageCountRow[]
  message?: string
}

export interface ArcImageCreateBatchPayload {
  items: ArcImageInput[]
}

export interface ArcImageCreateBatchResult {
  ok: boolean
  items?: ArcImageRow[]
  message?: string
}

export interface ArcImageUpdatePayload {
  imageId: string
  arcId?: string
  sortNo?: number
  currentHistoryId?: string | null
  rotation?: number
}

export interface ArcImageSaveResult {
  ok: boolean
  item?: ArcImageRow | null
  message?: string
}

export interface ArcImageDeletePayload {
  imageId: string
}

export interface ArcImageDeleteResult {
  ok: boolean
  removed?: number
  message?: string
}

// ---------- 图像处理历史 arcImageHistory ----------

export interface ArcImageHistoryRow {
  historyId: string
  imageId: string
  seqNo: number
  tempRelPath: string
  rotation: number
  actionLabel: string
  timeOfCreate: string
}

export interface ArcImageHistoryListPayload {
  imageId: string
}

export interface ArcImageHistoryListResult {
  ok: boolean
  items?: ArcImageHistoryRow[]
  message?: string
}

export interface ArcImageHistoryCreatePayload {
  imageId: string
  seqNo: number
  tempRelPath: string
  rotation: number
  actionLabel?: string
}

export interface ArcImageHistoryCreateResult {
  ok: boolean
  item?: ArcImageHistoryRow
  message?: string
}

export interface ArcImageHistoryTruncatePayload {
  imageId: string
  seqNo: number
}

export interface ArcImageHistoryTruncateResult {
  ok: boolean
  discarded?: ArcImageHistoryRow[]
  message?: string
}

// ---------- 档案字段值 arcFieldValue ----------

export interface ArcFieldValueRow {
  valueId: string
  arcId: string
  batFieldId: string
  fieldName: string
  fieldValue: string
}

export interface ArcFieldValueListPayload {
  arcId: string
}

export interface ArcFieldValueListResult {
  ok: boolean
  items?: ArcFieldValueRow[]
  message?: string
}

export interface ArcFieldValueUpsertItem {
  arcId: string
  batFieldId: string
  fieldName: string
  fieldValue: string
}

export interface ArcFieldValueUpsertPayload {
  items: ArcFieldValueUpsertItem[]
}

export interface ArcFieldValueUpsertResult {
  ok: boolean
  items?: ArcFieldValueRow[]
  message?: string
}

export interface ArcFieldValueSyncItem {
  batFieldId: string
  fieldName: string
  fieldValue: string
}

export interface ArcFieldValueSyncPayload {
  arcId: string
  items: ArcFieldValueSyncItem[]
}

export interface ArcFieldValueSyncResult {
  ok: boolean
  inserted?: number
  updated?: number
  deleted?: number
  message?: string
}

export interface RendererApi {
  openImages: () => Promise<OpenImagesResult>
  openImageFolder: () => Promise<OpenImagesResult>
  readPdfFile: (payload: ReadPdfFilePayload) => Promise<ReadPdfFileResult>
  getSettings: () => Promise<AppSettings>
  selectTempDir: () => Promise<SelectTempDirResult>
  openTempDir: () => Promise<OpenTempDirResult>
  getMachineCode: () => Promise<MachineCodeResult>
  setDefaultBgColor: (payload: SetDefaultBgColorPayload) => Promise<SetDefaultBgColorResult>
  saveTempImage: (payload: SaveTempImagePayload) => Promise<SaveTempImageResult>
  readTempImage: (payload: ReadTempImagePayload) => Promise<ReadTempImageResult>
  getImageBitDepth: (payload: ImageBitDepthPayload) => Promise<ImageBitDepthResult>
  cleanImageBorder: (payload: CleanImageBorderPayload) => Promise<CleanImageBorderResult>
  deleteTempImages: (payload: DeleteTempImagesPayload) => Promise<DeleteTempImagesResult>
  selectPdfFolder: () => Promise<SelectPdfFolderResult>
  openPdfFolder: (payload: OpenPdfFolderPayload) => Promise<OpenPdfFolderResult>
  exportPdf: (payload: PdfExportPayload) => Promise<PdfExportResult>
  exportArchiveExcel: (payload: ArchiveExcelExportPayload) => Promise<ArchiveExcelExportResult>
  getDatabaseInfo: () => Promise<DatabaseInfoResult>
  listConfig: () => Promise<ConfigListResult>
  getConfig: (payload: ConfigGetPayload) => Promise<ConfigGetResult>
  setConfig: (payload: ConfigSetPayload) => Promise<ConfigSetResult>
  deleteConfig: (payload: ConfigDeletePayload) => Promise<ConfigDeleteResult>
  listAiSettingInfo: () => Promise<AiSettingInfoListResult>
  createAiSettingInfo: (payload: AiSettingInfoSavePayload) => Promise<AiSettingInfoSaveResult>
  updateAiSettingInfo: (payload: AiSettingInfoUpdatePayload) => Promise<AiSettingInfoSaveResult>
  deleteAiSettingInfo: (payload: AiSettingInfoDeletePayload) => Promise<AiSettingInfoDeleteResult>
  setDefaultAiSettingInfo: (payload: AiSettingInfoDeletePayload) => Promise<AiSettingInfoSaveResult>
  testAiSettingInfo: (payload: AiSettingInfoTestPayload) => Promise<AiSettingInfoTestResult>
  aiChatStart: (payload: AiChatStartPayload) => Promise<AiChatStartResult>
  aiChatAbort: (payload: { requestId: string }) => void
  saveAiChatImage: (payload: AiChatImagePayload) => Promise<AiChatImageResult>
  onAiChatEvent: (callback: (event: AiChatEvent) => void) => () => void
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
  readImageFile: (payload: ReadImageFilePayload) => Promise<ReadImageFileResult>
  listArcInfo: (payload: ArcInfoListPayload) => Promise<ArcInfoListResult>
  createArcInfo: (payload: ArcInfoSavePayload) => Promise<ArcInfoSaveResult>
  updateArcInfo: (payload: ArcInfoUpdatePayload) => Promise<ArcInfoSaveResult>
  deleteArcInfo: (payload: ArcInfoDeletePayload) => Promise<ArcInfoDeleteResult>
  listArcImage: (payload: ArcImageListPayload) => Promise<ArcImageListResult>
  countArcImage: (payload: ArcImageCountPayload) => Promise<ArcImageCountResult>
  createArcImageBatch: (payload: ArcImageCreateBatchPayload) => Promise<ArcImageCreateBatchResult>
  updateArcImage: (payload: ArcImageUpdatePayload) => Promise<ArcImageSaveResult>
  deleteArcImage: (payload: ArcImageDeletePayload) => Promise<ArcImageDeleteResult>
  listArcImageHistory: (payload: ArcImageHistoryListPayload) => Promise<ArcImageHistoryListResult>
  createArcImageHistory: (
    payload: ArcImageHistoryCreatePayload
  ) => Promise<ArcImageHistoryCreateResult>
  truncateArcImageHistory: (
    payload: ArcImageHistoryTruncatePayload
  ) => Promise<ArcImageHistoryTruncateResult>
  listArcFieldValue: (payload: ArcFieldValueListPayload) => Promise<ArcFieldValueListResult>
  upsertArcFieldValue: (payload: ArcFieldValueUpsertPayload) => Promise<ArcFieldValueUpsertResult>
  syncArcFieldValue: (payload: ArcFieldValueSyncPayload) => Promise<ArcFieldValueSyncResult>
  recognizeRegion: (payload: OcrRecognizeRegionPayload) => Promise<OcrRecognizeRegionResult>
  onPdfExportProgress: (callback: (progress: PdfExportProgress) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}