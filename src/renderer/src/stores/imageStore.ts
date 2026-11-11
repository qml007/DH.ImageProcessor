import { reactive } from 'vue'
import type { ImportedImage } from '../../../preload/index.d'

export interface ImageHistoryState {
  historyId: string
  /** 相对临时文件夹的路径 */
  tempPath: string
  rotation: number
  label: string
}

export interface Archive {
  id: string
  name: string
}

export interface EditableImage extends ImportedImage {
  id: string
  arcId: string
  rotation: number
  tempPath?: string
  history: ImageHistoryState[]
  historyIndex: number
}

export interface AddImageItem extends ImportedImage {
  isPdf?: number
  pdfPageIndex?: number
  pdfPageCount?: number
}

type EditableImagePatch = Partial<
  Omit<EditableImage, 'id' | 'arcId' | 'history' | 'historyIndex'>
>

const BATCH_STORAGE_KEY = 'dh.currentBatchId'

const state = reactive({
  batId: localStorage.getItem(BATCH_STORAGE_KEY) ?? '',
  archives: [] as Archive[],
  /** 各档案的图像数量（进入页面时从数据库一次性统计） */
  archiveCounts: {} as Record<string, number>,
  activeArchiveId: '',
  images: [] as EditableImage[],
  loading: false
})

// 记录哪些档案的图像已从数据库加载
const loadedArchives = new Set<string>()

// 图像内容缓存：重新加载档案时复用，避免缩略图变空白
const dataUrlCache = new Map<string, string>()

const formatArchiveName = (value: number): string => String(value).padStart(4, '0')

const computeNextArchiveName = (): string => {
  const taken = new Set(state.archives.map((item) => item.name.trim()))
  const numeric = state.archives
    .map((item) => item.name.trim())
    .filter((name) => /^\d+$/.test(name))
    .map((name) => Number.parseInt(name, 10))

  let next = numeric.length ? Math.max(...numeric) + 1 : 1
  let name = formatArchiveName(next)

  while (taken.has(name)) {
    next += 1
    name = formatArchiveName(next)
  }

  return name
}

const loadHistoryFor = async (imageId: string): Promise<ImageHistoryState[]> => {
  const result = await window.api.listArcImageHistory({ imageId })
  if (!result.ok) return []
  return (result.items ?? [])
    .sort((a, b) => a.seqNo - b.seqNo)
    .map((item) => ({
      historyId: item.historyId,
      tempPath: item.tempRelPath,
      rotation: item.rotation,
      label: item.actionLabel || '处理记录'
    }))
}

const loadImages = async (arcId: string): Promise<void> => {
  if (!arcId) return

  state.loading = true
  try {
    const result = await window.api.listArcImage({ arcId })
    const rows = result.ok ? (result.items ?? []) : []

    const list: EditableImage[] = []
    for (const row of rows) {
      const history = await loadHistoryFor(row.imageId)
      const currentIndex = row.currentHistoryId
        ? history.findIndex((item) => item.historyId === row.currentHistoryId)
        : -1

      list.push({
        id: row.imageId,
        arcId: row.arcId,
        path: row.sourcePath,
        name: row.fileName,
        ext: row.ext,
        size: row.size,
        dataUrl: dataUrlCache.get(row.imageId) ?? '',
        rotation: row.rotation,
        tempPath: currentIndex >= 0 ? history[currentIndex].tempPath : undefined,
        history,
        historyIndex: currentIndex
      })
    }

    state.images = [...state.images.filter((item) => item.arcId !== arcId), ...list]
    state.archiveCounts[arcId] = list.length
    loadedArchives.add(arcId)
  } finally {
    state.loading = false
  }
}

/** 从数据库一次性统计当前批次下所有档案的图像数量 */
const refreshArchiveCounts = async (): Promise<void> => {
  const counts: Record<string, number> = {}
  for (const item of state.archives) counts[item.id] = 0

  const ids = state.archives.map((item) => item.id)
  if (ids.length) {
    try {
      const result = await window.api.countArcImage({ arcIds: ids })
      for (const row of result.items ?? []) {
        counts[row.arcId] = row.count
      }
    } catch {
      // 统计失败时保持 0，不阻塞页面
    }
  }

  state.archiveCounts = counts
}

const reloadArchives = async (): Promise<void> => {
  if (!state.batId) {
    state.archives = []
    state.archiveCounts = {}
    state.activeArchiveId = ''
    state.images = []
    return
  }

  const result = await window.api.listArcInfo({ batId: state.batId })
  const rows = result.ok ? (result.items ?? []) : []

  state.archives = rows.map((row) => ({ id: row.arcId, name: row.arcName }))

  if (!state.archives.some((item) => item.id === state.activeArchiveId)) {
    state.activeArchiveId = state.archives[0]?.id ?? ''
  }

  state.images = []
  loadedArchives.clear()

  await refreshArchiveCounts()

  if (state.activeArchiveId) {
    await loadImages(state.activeArchiveId)
  }
}

export const imageStore = {
  get batId(): string {
    return state.batId
  },

  get loading(): boolean {
    return state.loading
  },

  get images(): EditableImage[] {
    return state.images.filter((item) => item.arcId === state.activeArchiveId)
  },

  get archives(): Archive[] {
    return state.archives
  },

  get activeArchiveId(): string {
    return state.activeArchiveId
  },

  get activeArchive(): Archive | undefined {
    return state.archives.find((item) => item.id === state.activeArchiveId)
  },

  imagesOf(archiveId: string): EditableImage[] {
    return state.images.filter((item) => item.arcId === archiveId)
  },

  countOf(archiveId: string): number {
    const cached = state.archiveCounts[archiveId]
    if (typeof cached === 'number') return cached
    return state.images.filter((item) => item.arcId === archiveId).length
  },

  /** 确保指定档案的图像已从数据库加载（用于切换档案或导出前） */
  async ensureArchiveLoaded(archiveId: string): Promise<void> {
    if (!archiveId || loadedArchives.has(archiveId)) return
    await loadImages(archiveId)
  },

  nextArchiveName(): string {
    return computeNextArchiveName()
  },

  /** 切换当前批次并重新加载档案列表 */
  async setBatch(batId: string): Promise<void> {
    state.batId = batId
    state.activeArchiveId = ''
    localStorage.setItem(BATCH_STORAGE_KEY, batId)
    await reloadArchives()
  },

  /** 应用启动时按上次选择的批次恢复数据 */
  async restore(): Promise<void> {
    if (!state.batId) return
    await reloadArchives()
  },

  async reloadArchives(): Promise<void> {
    await reloadArchives()
  },

  selectArchive(id: string): void {
    if (!state.archives.some((item) => item.id === id)) return
    state.activeArchiveId = id
    if (!loadedArchives.has(id)) {
      void loadImages(id)
    }
  },

  async addArchive(name: string): Promise<Archive> {
    if (!state.batId) throw new Error('请先选择批次')

    const sortNo = state.archives.length
    const arcName = name.trim() || computeNextArchiveName()

    const result = await window.api.createArcInfo({
      batId: state.batId,
      arcName,
      sortNo
    })

    if (!result.ok || !result.item) {
      throw new Error(result.message || '新增档案失败')
    }

    const archive: Archive = { id: result.item.arcId, name: result.item.arcName }
    state.archives = [...state.archives, archive]
    state.archiveCounts[archive.id] = 0
    state.activeArchiveId = archive.id
    loadedArchives.add(archive.id)
    return archive
  },

  async removeArchive(id: string): Promise<boolean> {
    if (!state.archives.some((item) => item.id === id)) return false

    // 收集该档案全部图像的临时文件路径（含未加载到内存的部分）
    const tempPaths: string[] = []
    try {
      const imageRows = await window.api.listArcImage({ arcId: id })
      for (const row of imageRows.items ?? []) {
        dataUrlCache.delete(row.imageId)
        const history = await window.api.listArcImageHistory({ imageId: row.imageId })
        for (const item of history.items ?? []) {
          tempPaths.push(item.tempRelPath)
        }
      }
    } catch {
      // 收集失败不阻塞删除
    }

    const result = await window.api.deleteArcInfo({ arcId: id })
    if (!result.ok) return false

    if (tempPaths.length) {
      await window.api.deleteTempImages({ paths: tempPaths })
    }

    state.archives = state.archives.filter((item) => item.id !== id)
    state.images = state.images.filter((item) => item.arcId !== id)
    delete state.archiveCounts[id]
    loadedArchives.delete(id)

    if (state.activeArchiveId === id) {
      state.activeArchiveId = state.archives[0]?.id ?? ''
      if (state.activeArchiveId) {
        void loadImages(state.activeArchiveId)
      }
    }

    return true
  },

  async renameArchive(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim()
    if (!trimmed) return false
    if (state.archives.some((item) => item.id !== id && item.name.trim() === trimmed)) return false

    const result = await window.api.updateArcInfo({ arcId: id, arcName: trimmed })
    if (!result.ok) return false

    const target = state.archives.find((item) => item.id === id)
    if (target) target.name = trimmed
    return true
  },

  async moveImages(ids: string[], archiveId: string): Promise<number> {
    if (!state.archives.some((item) => item.id === archiveId)) return 0

    let moved = 0
    for (const id of ids) {
      const target = state.images.find((item) => item.id === id)
      if (!target || target.arcId === archiveId) continue

      const fromArcId = target.arcId
      const result = await window.api.updateArcImage({ imageId: id, arcId: archiveId })
      if (!result.ok) continue

      target.arcId = archiveId
      state.archiveCounts[fromArcId] = Math.max((state.archiveCounts[fromArcId] ?? 1) - 1, 0)
      state.archiveCounts[archiveId] = (state.archiveCounts[archiveId] ?? 0) + 1
      moved += 1
    }

    return moved
  },

  /**
   * 向指定档案导入图像：先写 arcImage，再为每张图生成 seq0 原始版本临时文件。
   */
  async add(list: AddImageItem[], archiveId = state.activeArchiveId): Promise<{
    added: number
    skipped: number
  }> {
    if (!state.batId) throw new Error('请先选择批次')

    // 批次下还没有任何档案时，自动创建默认档案，避免导入被静默丢弃
    let targetArcId = archiveId
    if (!targetArcId) {
      targetArcId = (await this.addArchive('')).id
    }

    const existing = new Set(
      state.images
        .filter((item) => item.arcId === targetArcId)
        .map((item) => `${item.path}#${item.name}`)
    )

    const accepted: AddImageItem[] = []
    let skipped = 0

    for (const item of list) {
      const key = `${item.path}#${item.name}`
      if (existing.has(key)) {
        skipped += 1
        continue
      }
      existing.add(key)
      accepted.push(item)
    }

    if (!accepted.length) return { added: 0, skipped }

    const startSort = state.images.filter((item) => item.arcId === targetArcId).length

    const created = await window.api.createArcImageBatch({
      items: accepted.map((item, index) => ({
        arcId: targetArcId,
        sortNo: startSort + index,
        sourcePath: item.path,
        fileName: item.name,
        ext: item.ext,
        size: item.size,
        isPdf: item.isPdf ?? 0,
        pdfPageIndex: item.pdfPageIndex ?? 0,
        pdfPageCount: item.pdfPageCount ?? 0
      }))
    })

    if (!created.ok || !created.items) {
      throw new Error(created.message || '写入图像记录失败')
    }

    const fresh: EditableImage[] = []

    for (let index = 0; index < created.items.length; index += 1) {
      const row = created.items[index]
      const source = accepted[index]

      const saved = await window.api.saveTempImage({
        arcId: targetArcId,
        imageId: row.imageId,
        seqNo: 0,
        dataUrl: source.dataUrl
      })

      let history: ImageHistoryState[] = []
      let historyIndex = -1
      let tempPath: string | undefined

      if (saved.ok && saved.relPath) {
        const rowHistory = await window.api.createArcImageHistory({
          imageId: row.imageId,
          seqNo: 0,
          tempRelPath: saved.relPath,
          rotation: 0,
          actionLabel: '原始图片'
        })

        if (rowHistory.ok && rowHistory.item) {
          history = [
            {
              historyId: rowHistory.item.historyId,
              tempPath: saved.relPath,
              rotation: 0,
              label: '原始图片'
            }
          ]
          historyIndex = 0
          tempPath = saved.relPath
          await window.api.updateArcImage({
            imageId: row.imageId,
            currentHistoryId: rowHistory.item.historyId,
            rotation: 0
          })
        }
      }

      fresh.push({
        id: row.imageId,
        arcId: row.arcId,
        path: row.sourcePath,
        name: row.fileName,
        ext: row.ext,
        size: row.size,
        dataUrl: source.dataUrl,
        rotation: 0,
        tempPath,
        history,
        historyIndex
      })
      if (source.dataUrl) {
        dataUrlCache.set(row.imageId, source.dataUrl)
      }
    }

    state.images = [...fresh, ...state.images]
    state.archiveCounts[targetArcId] = (state.archiveCounts[targetArcId] ?? 0) + fresh.length
    return { added: fresh.length, skipped }
  },

  find(id: string): EditableImage | undefined {
    return state.images.find((item) => item.id === id)
  },

  /** 从数据库/原始文件补齐图像内容（编辑页进入时使用） */
  async ensureImageData(id: string): Promise<void> {
    const target = state.images.find((item) => item.id === id)
    if (!target || target.dataUrl) return

    if (target.tempPath) {
      const cached = await window.api.readTempImage({ path: target.tempPath })
      if (cached.ok && cached.dataUrl) {
        target.dataUrl = cached.dataUrl
        dataUrlCache.set(id, cached.dataUrl)
        return
      }
    }

    if (target.path && !target.path.includes('#page=')) {
      const original = await window.api.readImageFile({ path: target.path })
      if (original.ok && original.dataUrl) {
        target.dataUrl = original.dataUrl
        dataUrlCache.set(id, original.dataUrl)
      }
    }
  },

  update(id: string, patch: EditableImagePatch): void {
    const target = state.images.find((item) => item.id === id)
    if (!target) return
    Object.assign(target, patch)
  },

  commitHistory(id: string, entry: ImageHistoryState): ImageHistoryState[] {
    const target = state.images.find((item) => item.id === id)
    if (!target) return []

    const keep = target.historyIndex + 1
    const discarded = target.history.slice(keep)

    target.history = [...target.history.slice(0, keep), entry]
    target.historyIndex = target.history.length - 1
    target.rotation = entry.rotation
    target.tempPath = entry.tempPath

    return discarded
  },

  /** 丢弃指定索引之后的版本（撤销后产生新操作时） */
  truncateHistory(id: string, keepIndex: number): ImageHistoryState[] {
    const target = state.images.find((item) => item.id === id)
    if (!target) return []

    const discarded = target.history.slice(keepIndex + 1)
    target.history = target.history.slice(0, keepIndex + 1)
    target.historyIndex = Math.min(target.historyIndex, target.history.length - 1)
    return discarded
  },

  moveHistory(id: string, index: number): void {
    const target = state.images.find((item) => item.id === id)
    if (!target) return
    if (index < 0 || index >= target.history.length) return
    target.historyIndex = index
  },

  async remove(id: string): Promise<void> {
    const target = state.images.find((item) => item.id === id)
    if (!target) return

    await window.api.deleteArcImage({ imageId: id })

    const paths = target.history.map((item) => item.tempPath)
    if (paths.length) {
      await window.api.deleteTempImages({ paths })
    }

    state.images = state.images.filter((item) => item.id !== id)
    state.archiveCounts[target.arcId] = Math.max((state.archiveCounts[target.arcId] ?? 1) - 1, 0)
    dataUrlCache.delete(id)
  },

  async clear(): Promise<void> {
    const archiveId = state.activeArchiveId
    if (!archiveId) return

    for (const item of state.images.filter((image) => image.arcId === archiveId)) {
      await this.remove(item.id)
    }
  }
}
