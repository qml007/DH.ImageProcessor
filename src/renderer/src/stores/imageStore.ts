import { reactive } from 'vue'
import type { ImportedImage } from '../../../preload/index.d'

export interface ImageHistoryState {
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
  archiveId: string
  rotation: number
  tempPath?: string
  history: ImageHistoryState[]
  historyIndex: number
}

type EditableImagePatch = Partial<
  Omit<EditableImage, 'id' | 'archiveId' | 'history' | 'historyIndex'>
>

const DEFAULT_ARCHIVE_ID = 'arc-1'

const state = reactive({
  archives: [{ id: DEFAULT_ARCHIVE_ID, name: '默认档案' }] as Archive[],
  activeArchiveId: DEFAULT_ARCHIVE_ID,
  images: [] as EditableImage[]
})

let sequence = 0
let archiveSequence = 1

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

export const imageStore = {
  get images(): EditableImage[] {
    return state.images.filter((item) => item.archiveId === state.activeArchiveId)
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

  get defaultArchiveId(): string {
    return DEFAULT_ARCHIVE_ID
  },

  imagesOf(archiveId: string): EditableImage[] {
    return state.images.filter((item) => item.archiveId === archiveId)
  },

  countOf(archiveId: string): number {
    return state.images.filter((item) => item.archiveId === archiveId).length
  },

  nextArchiveName(): string {
    return computeNextArchiveName()
  },

  addArchive(name: string): Archive {
    archiveSequence += 1
    const archive: Archive = {
      id: `arc-${archiveSequence}`,
      name: name.trim() || computeNextArchiveName()
    }

    state.archives = [...state.archives, archive]
    state.activeArchiveId = archive.id
    return archive
  },

  removeArchive(id: string): boolean {
    if (state.archives.length <= 1) return false
    if (!state.archives.some((item) => item.id === id)) return false

    state.archives = state.archives.filter((item) => item.id !== id)
    state.images = state.images.filter((item) => item.archiveId !== id)

    if (state.activeArchiveId === id) {
      state.activeArchiveId = state.archives[0].id
    }

    return true
  },

  selectArchive(id: string): void {
    if (!state.archives.some((item) => item.id === id)) return
    state.activeArchiveId = id
  },

  renameArchive(id: string, name: string): boolean {
    const trimmed = name.trim()
    if (!trimmed) return false

    const target = state.archives.find((item) => item.id === id)
    if (!target) return false
    if (state.archives.some((item) => item.id !== id && item.name.trim() === trimmed)) return false

    target.name = trimmed
    return true
  },

  moveImages(ids: string[], archiveId: string): number {
    if (!state.archives.some((item) => item.id === archiveId)) return 0

    let moved = 0
    for (const id of ids) {
      const target = state.images.find((item) => item.id === id)
      if (!target || target.archiveId === archiveId) continue
      target.archiveId = archiveId
      moved += 1
    }

    return moved
  },

  add(list: ImportedImage[]): { added: number; skipped: number } {
    const archiveId = state.activeArchiveId
    const existing = new Set(
      state.images.filter((item) => item.archiveId === archiveId).map((item) => item.path)
    )
    const fresh: EditableImage[] = []
    let skipped = 0

    for (const item of list) {
      if (existing.has(item.path)) {
        skipped += 1
        continue
      }
      existing.add(item.path)
      sequence += 1
      fresh.push({
        ...item,
        id: `img-${sequence}`,
        archiveId,
        rotation: 0,
        history: [],
        historyIndex: -1
      })
    }

    state.images = [...fresh, ...state.images]
    return { added: fresh.length, skipped }
  },

  find(id: string): EditableImage | undefined {
    return state.images.find((item) => item.id === id)
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

  moveHistory(id: string, index: number): void {
    const target = state.images.find((item) => item.id === id)
    if (!target) return
    if (index < 0 || index >= target.history.length) return
    target.historyIndex = index
  },

  remove(id: string): void {
    state.images = state.images.filter((item) => item.id !== id)
  },

  clear(): void {
    state.images = state.images.filter((item) => item.archiveId !== state.activeArchiveId)
  }
}