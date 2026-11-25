<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
  watch
} from 'vue'
import { useRouter } from 'vue-router'
import {
  imageStore,
  type Archive,
  type AddImageItem,
  type EditableImage
} from '../stores/imageStore'
import type {
  OpenImagesResult,
  PdfExportArchive,
  PdfExportArchiveResult,
  PdfExportFailure,
  PdfExportProgress,
  PdfSourceFile
} from '../../../preload/index.d'
import { formatSize } from '../utils/format'
import { isPdfReadyDataUrl, toPdfJpegDataUrl } from '../utils/image'
import { rasterizePdf } from '../utils/pdf'
import { markTabReplace } from '../utils/tabs'

const router = useRouter()

const images = computed(() => imageStore.images)
const archives = computed(() => imageStore.archives)
const activeArchiveId = computed(() => imageStore.activeArchiveId)
const activeArchiveName = computed(() => imageStore.activeArchive?.name ?? '')
const viewMode = ref<'grid' | 'list'>('grid')
const loading = ref(false)
const message = ref('')
const pdfProgress = ref('')

interface BatchOption {
  batId: string
  batCode: string
  arcTypeId: string
  arcTypeName: string
  status: number
  arcNamePreStr: string
}

const batches = ref<BatchOption[]>([])
const batchId = ref(imageStore.batId)

const loadBatches = async (): Promise<void> => {
  try {
    const result = await window.api.listBatInfo()
    if (result.ok) {
      // 图像处理只针对进行中的批次，已完成的批次不再列出
      batches.value = (result.items ?? [])
        .filter((item) => item.status === 0)
        .map((item) => ({
          batId: item.batId,
          batCode: item.batCode,
          arcTypeId: item.arcTypeId,
          arcTypeName: item.arcTypeName,
          status: item.status,
          arcNamePreStr: item.arcNamePreStr ?? ''
        }))
    }

    if (!batches.value.some((item) => item.batId === batchId.value)) {
      batchId.value = batches.value[0]?.batId ?? ''
    }

    if (batchId.value !== imageStore.batId) {
      await imageStore.setBatch(batchId.value)
    } else if (batchId.value) {
      await imageStore.restore()
    }
  } catch (error) {
    console.error(error)
  }
}

const onBatchChange = async (): Promise<void> => {
  if (!batchId.value) return
  await imageStore.setBatch(batchId.value)
  clearSelection()
  resetMark()
}

// 从数据库加载的图像未带内容，进入页面或切换档案后按需补齐缩略图
// key 同时包含是否有内容，档案重新加载后即使图像 id 不变也能触发补齐（避免处理后返回列表显示旧图）
watch(
  () => images.value.map((item) => `${item.id}:${item.dataUrl ? '1' : '0'}`).join('|'),
  async () => {
    for (const item of images.value) {
      if (!item.dataUrl) {
        await imageStore.ensureImageData(item.id)
      }
    }
  },
  { immediate: true }
)

const creatingArchive = ref(false)
const newArchiveName = ref('')

const editingArchiveId = ref<string | null>(null)
const editingArchiveName = ref('')

const selectedIds = ref<string[]>([])
const dragIds = ref<string[]>([])
const dragOverArchiveId = ref<string | null>(null)

const currentImageId = ref<string | null>(null)
const markAnchorId = ref<string | null>(null)

const exporting = ref(false)
const excelExporting = ref(false)

const exportOptions = reactive({
  visible: false,
  doubleLayer: true,
  dir: ''
})

const exportState = reactive({
  visible: false,
  finished: false,
  total: 0,
  done: 0,
  remaining: 0,
  current: '',
  images: 0,
  failed: 0,
  message: '',
  dir: '',
  failures: [] as PdfExportFailure[]
})

const exportPercent = computed(() => {
  if (!exportState.total) return 0
  return Math.round((exportState.done / exportState.total) * 100)
})

const exportTargets = computed(() =>
  archives.value.filter((item) => imageStore.countOf(item.id) > 0)
)

const totalSize = computed(() => images.value.reduce((sum, item) => sum + item.size, 0))

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

const flashMessage = (text: string): void => {
  message.value = text
  window.setTimeout(() => {
    message.value = ''
  }, 2500)
}

const pdfArchiveName = (name: string): string => {
  const stripped = name.replace(/\.pdf$/i, '').trim()
  return stripped || name.trim()
}

const importPdfFile = async (
  source: PdfSourceFile,
  index: number,
  total: number
): Promise<number> => {
  pdfProgress.value = `正在读取 PDF（${index + 1}/${total}）「${source.name}」`

  const read = await window.api.readPdfFile({ path: source.path })
  if (!read.ok || !read.data) throw new Error(read.message || '无法读取该 PDF 文件')

  const pages = await rasterizePdf(read.data, {
    onProgress: (page, count) => {
      pdfProgress.value = `正在拆分 PDF（${index + 1}/${total}）「${source.name}」第 ${page}/${count} 页`
    }
  })

  if (!pages.length) throw new Error('该 PDF 没有可用的页面')

  const archiveName = pdfArchiveName(source.name)
  const existing = archives.value.find((item) => item.name.trim() === archiveName)
  const archive = existing ?? (await imageStore.addArchive(archiveName))
  imageStore.selectArchive(archive.id)

  const list: AddImageItem[] = pages.map((item) => ({
    path: `${source.path}#page=${item.page}`,
    name: `${archiveName}_${String(item.page).padStart(3, '0')}.jpg`,
    ext: 'jpg',
    size: item.size,
    dataUrl: item.dataUrl,
    isPdf: 1,
    pdfPageIndex: item.page,
    pdfPageCount: pages.length
  }))

  return (await imageStore.add(list, archive.id)).added
}

const applyImported = async (result: OpenImagesResult): Promise<void> => {
  if (result.message) {
    flashMessage(result.message)
    return
  }

  let added = 0
  let skipped = 0
  let pdfArchives = 0
  let pdfPages = 0
  let pdfFailed = 0

  if (result.images.length) {
    const summary = await imageStore.add(result.images)
    added += summary.added
    skipped += summary.skipped
  }

  const pdfs = result.pdfs ?? []

  for (let index = 0; index < pdfs.length; index += 1) {
    try {
      const pages = await importPdfFile(pdfs[index], index, pdfs.length)
      if (pages) {
        pdfArchives += 1
        pdfPages += pages
      }
    } catch (error) {
      console.error(error)
      pdfFailed += 1
    }
  }

  pdfProgress.value = ''

  const parts: string[] = []
  if (added) parts.push(`导入 ${added} 张图片`)
  if (skipped) parts.push(`跳过 ${skipped} 张重复图片`)
  if (pdfPages) parts.push(`PDF 共 ${pdfArchives} 个档案 ${pdfPages} 页`)
  if (pdfFailed) parts.push(`${pdfFailed} 个 PDF 解析失败`)

  flashMessage(parts.length ? parts.join('，') : '未读取到可用的图像')
}

const importImages = async (): Promise<void> => {
  loading.value = true
  try {
    const result = await window.api.openImages()
    if (result.canceled) return
    await applyImported(result)
  } catch (error) {
    console.error(error)
    flashMessage('导入失败，请稍后重试')
  } finally {
    pdfProgress.value = ''
    loading.value = false
  }
}

const importFolder = async (): Promise<void> => {
  loading.value = true
  try {
    const result = await window.api.openImageFolder()
    if (result.canceled) return
    await applyImported(result)
  } catch (error) {
    console.error(error)
    flashMessage('导入失败，请稍后重试')
  } finally {
    pdfProgress.value = ''
    loading.value = false
  }
}

const editImage = (target: EditableImage): void => {
  // 进入编辑页复用当前标签，避免新开标签
  const to = { name: 'image-edit', params: { id: target.id } }
  markTabReplace(router.resolve(to).path)
  router.push(to)
}

const applyExportProgress = (progress: PdfExportProgress): void => {
  if (!exportState.visible) return

  exportState.total = progress.total
  exportState.done = progress.done
  exportState.remaining = progress.remaining

  if (progress.phase === 'start') {
    exportState.current = progress.current
    exportState.images = progress.images ?? 0
    exportState.message = ''
    return
  }

  if (progress.phase === 'file') {
    exportState.message = progress.message ?? ''
    return
  }

  if (progress.phase === 'ocr') {
    exportState.current = progress.current
    exportState.message = progress.message ?? '正在识别文字…'
    return
  }

  exportState.current = ''
  exportState.finished = true
  exportState.failed = progress.failures ?? 0
}

interface PreparedArchiveImages {
  images: string[]
  metas: Array<{ imageId: string; historyId: string }>
}

const prepareArchiveImages = async (archiveId: string): Promise<PreparedArchiveImages> => {
  // 未加载过的档案（如未在列表中选中过）先从数据库补齐图像
  await imageStore.ensureArchiveLoaded(archiveId)
  const source = imageStore.imagesOf(archiveId)
  const prepared: string[] = []
  const metas: Array<{ imageId: string; historyId: string }> = []

  for (const image of source) {
    if (!image.dataUrl) {
      await imageStore.ensureImageData(image.id)
    }

    metas.push({
      imageId: image.id,
      historyId: image.history[image.historyIndex]?.historyId ?? ''
    })

    if (isPdfReadyDataUrl(image.dataUrl)) {
      prepared.push(image.dataUrl)
      continue
    }

    try {
      prepared.push(await toPdfJpegDataUrl(image.dataUrl))
    } catch (error) {
      console.error('Failed to convert image for PDF:', image.name, error)
      prepared.push(image.dataUrl)
    }
  }

  return { images: prepared, metas }
}

const retrySkippedImages = async (
  dir: string,
  doubleLayer: boolean,
  archives: PdfExportArchive[],
  results: PdfExportArchiveResult[]
): Promise<PdfExportArchiveResult[]> => {
  const merged = [...results]

  for (let index = 0; index < merged.length; index += 1) {
    const current = merged[index]
    const source = archives[index]

    if (!source || !current.skippedIndexes.length) continue

    const images = [...source.images]

    for (const skippedIndex of current.skippedIndexes) {
      if (skippedIndex < 0 || skippedIndex >= images.length) continue

      try {
        images[skippedIndex] = await toPdfJpegDataUrl(images[skippedIndex])
      } catch (error) {
        console.error('Failed to convert skipped image:', error)
      }
    }

    try {
      const retried = await window.api.exportPdf({
        dir,
        silent: true,
        doubleLayer,
        archives: [{ name: source.name, fileName: current.fileName, images, metas: source.metas }]
      })

      if (retried.results[0]) merged[index] = retried.results[0]
    } catch (error) {
      console.error('Failed to retry PDF export:', error)
    }
  }

  return merged
}

const openExportOptions = (): void => {
  if (exporting.value) return

  if (!exportTargets.value.length) {
    flashMessage('没有可导出的档案，请先把图像移到「默认档案」之外的档案中')
    return
  }

  exportOptions.doubleLayer = true
  exportOptions.dir = ''
  exportOptions.visible = true
}

const closeExportOptions = (): void => {
  if (exporting.value) return
  exportOptions.visible = false
}

const pickExportFolder = async (): Promise<void> => {
  if (exporting.value) return

  try {
    const folder = await window.api.selectPdfFolder()
    if (folder.canceled || !folder.dir) return
    exportOptions.dir = folder.dir
  } catch (error) {
    console.error(error)
    flashMessage('选择文件夹失败，请稍后重试')
  }
}

const startExport = async (): Promise<void> => {
  if (exporting.value) return

  if (!exportOptions.dir) {
    flashMessage('请先选择导出文件夹')
    return
  }

  const dir = exportOptions.dir
  const doubleLayer = exportOptions.doubleLayer
  exportOptions.visible = false
  await exportPdf(dir, doubleLayer)
}

const exportPdf = async (dir: string, doubleLayer: boolean): Promise<void> => {
  if (exporting.value) return

  const targets = exportTargets.value
  if (!targets.length) {
    flashMessage('没有可导出的档案，请先把图像移到「默认档案」之外的档案中')
    return
  }

  exporting.value = true
  Object.assign(exportState, {
    visible: true,
    finished: false,
    total: targets.length,
    done: 0,
    remaining: targets.length,
    current: '',
    images: 0,
    failed: 0,
    message: '',
    dir,
    failures: []
  })

  try {
    const archives: PdfExportArchive[] = []
    const preStr = imageStore.arcNamePreStr ?? ''

    for (const item of targets) {
      const prepared = await prepareArchiveImages(item.id)
      const archive: PdfExportArchive = {
        name: item.name,
        images: prepared.images,
        fileName: sanitizeFileName(`${preStr}${item.name}`)
      }
      // 单层 PDF 不携带 OCR 版本信息，确保不会写入任何文字层
      if (doubleLayer) archive.metas = prepared.metas
      archives.push(archive)
    }

    const payload = { dir, doubleLayer, archives }
    const result = await window.api.exportPdf(payload)

    if (!result.ok) {
      exportState.finished = true
      exportState.failed = result.failed
      exportState.done = result.done
      exportState.remaining = Math.max(result.total - result.done, 0)
      exportState.message = result.message ?? '导出失败'
      flashMessage(exportState.message)
      return
    }

    exportState.current = ''
    exportState.message = ''
    exportState.images = 0

    const finalResults = await retrySkippedImages(dir, doubleLayer, archives, result.results)
    const exported = finalResults.filter((item) => item.ok).length
    const failed = finalResults.length - exported

    exportState.finished = true
    exportState.done = result.done
    exportState.remaining = Math.max(result.total - result.done, 0)
    exportState.failed = failed
    exportState.failures = finalResults
      .filter((item) => !item.ok)
      .map((item) => ({ name: item.name, message: item.message || '导出失败' }))

    if (!exported) {
      exportState.message = '导出失败，请检查图像格式或输出文件夹'
      flashMessage(exportState.message)
      return
    }

    flashMessage(
      failed ? `已导出 ${exported} 个 PDF，${failed} 个档案失败` : `已导出 ${exported} 个 PDF 文件`
    )
  } catch (error) {
    console.error(error)
    exportState.finished = true
    exportState.message = '导出失败，请稍后重试'
    flashMessage(exportState.message)
  } finally {
    exporting.value = false
  }
}

const closeExportModal = (): void => {
  if (exporting.value) return
  exportState.visible = false
}

const exportExcel = async (): Promise<void> => {
  if (excelExporting.value) return

  if (!archives.value.length) {
    flashMessage('当前批次没有档案，无法导出 Excel')
    return
  }

  excelExporting.value = true
  try {
    const result = await window.api.exportArchiveExcel({ batId: imageStore.batId })
    if (result.canceled) return

    if (!result.ok) {
      flashMessage(result.message || '导出 Excel 失败')
      return
    }

    flashMessage(`已导出 ${result.count ?? archives.value.length} 个档案的 Excel 文件`)
  } catch (error) {
    console.error(error)
    flashMessage('导出 Excel 失败，请稍后重试')
  } finally {
    excelExporting.value = false
  }
}

const removeImage = async (target: EditableImage): Promise<void> => {
  await imageStore.remove(target.id)
  selectedIds.value = selectedIds.value.filter((item) => item !== target.id)

  if (markAnchorId.value === target.id) {
    markAnchorId.value = null
    clearSelection()
  }

  if (currentImageId.value === target.id) currentImageId.value = null
}

const clearAll = async (): Promise<void> => {
  await imageStore.clear()
  clearSelection()
  resetMark()
}

// 将当前批次由“进行中”标记为“已完成”，完成后不再出现在批次下拉列表
const completing = ref(false)

const completeBatch = async (): Promise<void> => {
  if (completing.value || !batchId.value) return

  const current = batches.value.find((item) => item.batId === batchId.value)
  if (!current) return

  const confirmed = confirm(
    `确定将批次「${current.batCode}」标记为已完成？完成后该批次将从批次下拉列表中移除。`
  )
  if (!confirmed) return

  completing.value = true
  try {
    const result = await window.api.updateBatInfo({
      batId: current.batId,
      arcTypeId: current.arcTypeId,
      status: 1
    })
    if (!result.ok) {
      alert(result.message ?? '更新批次状态失败')
      return
    }

    await loadBatches()
    clearSelection()
    resetMark()
    flashMessage(`批次「${current.batCode}」已完成`)
  } catch (error) {
    alert(error instanceof Error ? error.message : '未知错误')
  } finally {
    completing.value = false
  }
}

const isSelected = (id: string): boolean => selectedIds.value.includes(id)

const toggleSelect = (id: string): void => {
  selectedIds.value = isSelected(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

const clearSelection = (): void => {
  selectedIds.value = []
}

const resetMark = (): void => {
  currentImageId.value = null
  markAnchorId.value = null
}

const rangeIds = (anchorId: string, targetId: string): string[] => {
  const ids = images.value.map((item) => item.id)
  const from = ids.indexOf(anchorId)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0) return []

  const [start, end] = from <= to ? [from, to] : [to, from]
  return ids.slice(start, end + 1)
}

const handleImageClick = (item: EditableImage): void => {
  currentImageId.value = item.id

  if (markAnchorId.value) {
    selectedIds.value = rangeIds(markAnchorId.value, item.id)
    return
  }

  toggleSelect(item.id)
}

const startRangeMark = (): void => {
  const current = currentImageId.value
  if (!current || !images.value.some((item) => item.id === current) || !isSelected(current)) {
    flashMessage('请先单击选中一张图像，再按 F7 标记选择起点')
    return
  }

  markAnchorId.value = current
  selectedIds.value = [current]

  const name = images.value.find((item) => item.id === current)?.name ?? ''
  flashMessage(`已标记起点「${name}」，移动到结束图像后按 F8 完成`)
}

const finishRangeMark = async (): Promise<void> => {
  const ids = markAnchorId.value
    ? rangeIds(markAnchorId.value, currentImageId.value ?? markAnchorId.value)
    : [...selectedIds.value]

  const targets = ids.filter((id) => images.value.some((item) => item.id === id))
  if (!targets.length) {
    flashMessage('没有可归档的图像，请先选中图像（F7 标记起点，F8 完成）')
    return
  }

  const previousArchiveId = activeArchiveId.value
  const archive = await imageStore.addArchive('')
  const moved = await imageStore.moveImages(targets, archive.id)

  imageStore.selectArchive(previousArchiveId)
  clearSelection()
  resetMark()

  flashMessage(`已新增档案「${archive.name}」，移入 ${moved} 张图像`)
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null
  if (!element) return false

  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable
}

const onKeydown = (event: KeyboardEvent): void => {
  if (isEditableTarget(event.target)) return

  if (event.key === 'F7') {
    event.preventDefault()
    startRangeMark()
    return
  }

  if (event.key === 'F8') {
    event.preventDefault()
    finishRangeMark()
  }
}

let unsubscribeProgress: (() => void) | null = null

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  unsubscribeProgress = window.api.onPdfExportProgress(applyExportProgress)
  void loadBatches()
})

// 作为标签页被缓存时：失活解绑快捷键，重新激活后恢复
onDeactivated(() => {
  window.removeEventListener('keydown', onKeydown)
})

onActivated(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  unsubscribeProgress?.()
  unsubscribeProgress = null
})

const startCreateArchive = (): void => {
  creatingArchive.value = true
  newArchiveName.value = imageStore.nextArchiveName()
}

const cancelCreateArchive = (): void => {
  creatingArchive.value = false
  newArchiveName.value = ''
}

const confirmCreateArchive = async (): Promise<void> => {
  try {
    const archive = await imageStore.addArchive(newArchiveName.value)
    cancelCreateArchive()
    flashMessage(`已新增档案「${archive.name}」`)
  } catch (error) {
    flashMessage(error instanceof Error ? error.message : '新增档案失败')
  }
}

const selectArchive = (id: string): void => {
  if (id === activeArchiveId.value) return
  imageStore.selectArchive(id)
  clearSelection()
  resetMark()
}

const deleteArchive = async (): Promise<void> => {
  if (archives.value.length <= 1) {
    flashMessage('至少需要保留一个档案')
    return
  }

  const name = activeArchiveName.value
  const removed = await imageStore.removeArchive(activeArchiveId.value)

  clearSelection()
  resetMark()
  flashMessage(removed ? `已删除档案「${name}」` : '删除失败，请稍后重试')
}

const startRenameArchive = (archive: Archive): void => {
  editingArchiveId.value = archive.id
  editingArchiveName.value = archive.name
  shouldSelectOnFocus = true
}

const cancelRenameArchive = (): void => {
  editingArchiveId.value = null
  editingArchiveName.value = ''
}

const confirmRenameArchive = async (): Promise<void> => {
  const id = editingArchiveId.value
  if (!id) return

  const current = archives.value.find((item) => item.id === id)
  const name = editingArchiveName.value.trim()

  if (!name) {
    flashMessage('档案名称不能为空')
    return
  }

  if (current && current.name === name) {
    cancelRenameArchive()
    return
  }

  if (!(await imageStore.renameArchive(id, name))) {
    flashMessage(`档案「${name}」已存在，请换一个名称`)
    return
  }

  cancelRenameArchive()
  flashMessage(`已重命名为「${name}」`)
}

// 函数型 ref 在每次组件重渲染时都会调用；用标志位确保 select() 只在首次进入编辑时执行一次
let shouldSelectOnFocus = false
const setRenameInput = (el: unknown): void => {
  const input = (el as HTMLInputElement | null) ?? null
  if (!input) return

  input.focus()
  if (shouldSelectOnFocus) {
    input.select()
    shouldSelectOnFocus = false
  }
}

const onImageDragStart = (event: DragEvent, item: EditableImage): void => {
  if (!isSelected(item.id)) selectedIds.value = [item.id]

  dragIds.value = [...selectedIds.value]
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', dragIds.value.join(','))
    event.dataTransfer.effectAllowed = 'move'
  }
}

const onImageDragEnd = (): void => {
  dragIds.value = []
  dragOverArchiveId.value = null
}

const onArchiveDragOver = (archiveId: string, event: DragEvent): void => {
  if (!dragIds.value.length) return

  event.preventDefault()
  dragOverArchiveId.value = archiveId
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

const onArchiveDragLeave = (archiveId: string): void => {
  if (dragOverArchiveId.value === archiveId) dragOverArchiveId.value = null
}

const onArchiveDrop = async (archiveId: string, event: DragEvent): Promise<void> => {
  event.preventDefault()

  const ids = dragIds.value.length
    ? dragIds.value
    : (event.dataTransfer?.getData('text/plain') ?? '').split(',').filter(Boolean)

  dragOverArchiveId.value = null
  dragIds.value = []

  if (!ids.length) return

  if (archiveId === activeArchiveId.value) {
    flashMessage('这些图像已经在当前档案中')
    return
  }

  const moved = await imageStore.moveImages(ids, archiveId)
  if (!moved) {
    flashMessage('移动失败，请稍后重试')
    return
  }

  const targetName = archives.value.find((item) => item.id === archiveId)?.name ?? ''
  clearSelection()
  resetMark()
  flashMessage(`已将 ${moved} 张图像移到档案「${targetName}」`)
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">导入图像</h2>
        <p class="page-description">
          单击图像可选中多张并拖到左侧档案；按 F7 标记起点、按 F8
          结束并移入新档案；双击图像或点击「点击进入编辑」进入编辑页面。 支持导入 PDF：每个 PDF
          会按文件名新建档案，并按页拆分为图像。
        </p>
      </div>
      <div class="page-actions">
        <div class="batch-select">
          <span class="batch-label">批次</span>
          <select
            v-model="batchId"
            class="input batch-input"
            title="选择批次后，档案与图像都会挂在所选批次下"
            @change="onBatchChange"
          >
            <option value="" disabled>请选择批次</option>
            <option v-for="b in batches" :key="b.batId" :value="b.batId">
              {{ b.batCode }} · {{ b.arcTypeName }}
            </option>
          </select>
        </div>
        <div class="view-switch">
          <button type="button" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
            缩略图
          </button>
          <button type="button" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">
            列表
          </button>
        </div>
        <div class="action-group">
          <div class="action-subgroup">
            <button
              class="btn btn-icon"
              type="button"
              title="完成当前批次（标记为已完成）"
              aria-label="完成当前批次"
              :disabled="completing || !batchId"
              @click="completeBatch"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.5 2.5 2.5 4.5-5" />
              </svg>
            </button>
          </div>
          <div class="action-subgroup">
            <button
              class="btn btn-icon"
              type="button"
              title="清空当前档案的图像"
              aria-label="清空当前档案的图像"
              :disabled="!images.length"
              @click="clearAll"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4 7h16" />
                <path d="M9 7V5h6v2" />
                <path d="M6 7l1 13h10l1-13" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
          </div>
          <div class="action-subgroup">
            <button
              class="btn btn-icon"
              type="button"
              :title="loading ? '读取中…' : '导入图像/PDF'"
              aria-label="导入图像/PDF"
              :disabled="loading || !batchId"
              @click="importImages"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="m5 19 4.5-4.5 3 3L16 14l4 4" />
                <path d="M18 2v5" />
                <path d="M15.5 4.5h5" />
              </svg>
            </button>
            <button
              class="btn btn-icon"
              type="button"
              :title="loading ? '读取中…' : '导入文件夹'"
              aria-label="导入文件夹"
              :disabled="loading || !batchId"
              @click="importFolder"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                />
                <path d="M12 11v6" />
                <path d="M9 14h6" />
              </svg>
            </button>
          </div>
          <div class="action-subgroup">
            <button
              class="btn btn-icon"
              type="button"
              :title="
                exporting
                  ? '正在导出 PDF…'
                  : exportTargets.length
                    ? '按档案导出 PDF'
                    : '请先把图像移到默认档案之外'
              "
              aria-label="导出 PDF"
              :disabled="exporting || !exportTargets.length"
              @click="openExportOptions"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5" />
                <path d="M12 11v6" />
                <path d="m9 14 3 3 3-3" />
              </svg>
            </button>
            <button
              class="btn btn-icon"
              type="button"
              :title="
                excelExporting
                  ? '正在导出 Excel…'
                  : archives.length
                    ? '导出当前批次所有档案的字段信息'
                    : '当前批次还没有档案'
              "
              aria-label="导出 Excel"
              :disabled="excelExporting || !archives.length"
              @click="exportExcel"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
                <path d="M3 14h18" />
                <path d="M10 9v11" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="page-body">
      <aside class="card archive-panel">
        <div class="card-header">
          <h3 class="card-title">档案列表</h3>
          <span class="card-subtitle">{{ archives.length }} 个</span>
        </div>

        <div class="archive-toolbar">
          <button class="btn btn-sm btn-primary" type="button" @click="startCreateArchive">
            新增
          </button>
          <button
            class="btn btn-sm btn-danger"
            type="button"
            :disabled="archives.length <= 1"
            @click="deleteArchive"
          >
            删除
          </button>
        </div>

        <div v-if="creatingArchive" class="archive-form">
          <input
            v-model="newArchiveName"
            class="input"
            type="text"
            placeholder="请输入档案名称"
            @keyup.enter="confirmCreateArchive"
            @keyup.esc="cancelCreateArchive"
          />
          <div class="archive-form-foot">
            <button class="btn btn-sm btn-primary" type="button" @click="confirmCreateArchive">
              确定
            </button>
            <button class="btn btn-sm" type="button" @click="cancelCreateArchive">取消</button>
          </div>
        </div>

        <ul class="archive-list">
          <li
            v-for="archive in archives"
            :key="archive.id"
            class="archive-item"
            :class="{
              active: archive.id === activeArchiveId,
              'drop-target': dragOverArchiveId === archive.id
            }"
            role="button"
            tabindex="0"
            @click="selectArchive(archive.id)"
            @keydown.enter="selectArchive(archive.id)"
            @dragover="onArchiveDragOver(archive.id, $event)"
            @dragleave="onArchiveDragLeave(archive.id)"
            @drop="onArchiveDrop(archive.id, $event)"
          >
            <input
              v-if="editingArchiveId === archive.id"
              :ref="setRenameInput"
              v-model="editingArchiveName"
              class="archive-input"
              type="text"
              maxlength="40"
              @click.stop
              @dblclick.stop
              @keydown.enter.stop.prevent="confirmRenameArchive"
              @keydown.esc.stop.prevent="cancelRenameArchive"
              @blur="confirmRenameArchive"
            />
            <span
              v-else
              class="archive-name"
              :title="`${archive.name}（双击可重命名）`"
              @dblclick.stop="startRenameArchive(archive)"
            >
              {{ archive.name }}
            </span>
            <span class="archive-count">{{ imageStore.countOf(archive.id) }}</span>
          </li>
        </ul>
      </aside>

      <section class="card">
        <div class="card-header">
          <div class="summary">
            <h3 class="card-title">图像资源</h3>
            <span class="card-subtitle">
              共 {{ images.length }} 张 · {{ formatSize(totalSize) }}
            </span>
          </div>
          <span v-if="pdfProgress" class="tag tag-primary">{{ pdfProgress }}</span>
          <span v-else-if="markAnchorId" class="tag tag-warning">
            已标记起点 · 点击结束图像后按 F8 归档
          </span>
          <span v-else-if="selectedIds.length" class="tag tag-primary">
            已选 {{ selectedIds.length }} 张 · 拖到左侧档案可移动
          </span>
          <span v-else-if="message" class="tag tag-success">{{ message }}</span>
        </div>

        <div v-if="!images.length" class="empty-state">
          <p>还没有导入任何图像</p>
          <p class="empty-hint">点击右上角「导入图像」按钮，可一次选择多张图像或 PDF 文件。</p>
        </div>

        <div v-else-if="viewMode === 'grid'" class="thumb-grid">
          <article
            v-for="item in images"
            :key="item.id"
            class="thumb-card"
            :class="{ selected: isSelected(item.id) }"
            draggable="true"
            @click="handleImageClick(item)"
            @dblclick="editImage(item)"
            @dragstart="onImageDragStart($event, item)"
            @dragend="onImageDragEnd"
          >
            <div class="thumb-preview">
              <img :src="item.dataUrl" :alt="item.name" draggable="false" />
              <button class="thumb-edit-btn" type="button" @click.stop="editImage(item)">
                点击进入编辑
              </button>
            </div>
            <div class="thumb-meta">
              <p class="thumb-name" :title="item.name">{{ item.name }}</p>
              <div class="thumb-foot">
                <span>{{ item.ext.toUpperCase() }} · {{ formatSize(item.size) }}</span>
                <button class="link-btn danger" type="button" @click.stop="removeImage(item)">
                  移除
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th class="col-preview">预览</th>
                <th>文件名</th>
                <th>格式</th>
                <th>大小</th>
                <th>路径</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in images"
                :key="item.id"
                class="image-row"
                :class="{ selected: isSelected(item.id) }"
                draggable="true"
                @click="handleImageClick(item)"
                @dblclick="editImage(item)"
                @dragstart="onImageDragStart($event, item)"
                @dragend="onImageDragEnd"
              >
                <td class="col-preview">
                  <div class="mini-preview">
                    <img :src="item.dataUrl" :alt="item.name" draggable="false" />
                  </div>
                </td>
                <td class="col-name">{{ item.name }}</td>
                <td>{{ item.ext.toUpperCase() }}</td>
                <td>{{ formatSize(item.size) }}</td>
                <td class="col-path" :title="item.path">{{ item.path }}</td>
                <td class="col-actions">
                  <button class="link-btn" type="button" @click.stop="editImage(item)">编辑</button>
                  <button class="link-btn danger" type="button" @click.stop="removeImage(item)">
                    移除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div v-if="exportOptions.visible" class="export-mask">
      <div class="export-dialog">
        <h3 class="export-title">导出选项</h3>

        <div class="export-field">
          <span class="export-field-label">PDF 类型</span>
          <div class="export-radios">
            <label class="export-radio">
              <input v-model="exportOptions.doubleLayer" type="radio" :value="false" />
              <span>
                单层 PDF
                <em>导出时不做 OCR，仅生成图像 PDF</em>
              </span>
            </label>
            <label class="export-radio">
              <input v-model="exportOptions.doubleLayer" type="radio" :value="true" />
              <span>
                双层 PDF
                <em>导出时先 OCR，生成可检索、可复制的双层 PDF</em>
              </span>
            </label>
          </div>
        </div>

        <div class="export-field">
          <span class="export-field-label">导出文件夹</span>
          <div class="export-folder">
            <span
              class="export-folder-path"
              :class="{ 'is-empty': !exportOptions.dir }"
              :title="exportOptions.dir"
            >
              {{ exportOptions.dir || '尚未选择文件夹' }}
            </span>
            <button class="btn btn-sm" type="button" @click="pickExportFolder">选择文件夹</button>
          </div>
        </div>

        <div class="export-foot export-foot-actions">
          <button class="btn btn-sm" type="button" @click="closeExportOptions">取消</button>
          <button
            class="btn btn-sm btn-primary"
            type="button"
            :disabled="!exportOptions.dir"
            @click="startExport"
          >
            开始导出
          </button>
        </div>
      </div>
    </div>

    <div v-if="excelExporting" class="export-mask">
      <div class="export-dialog excel-dialog">
        <h3 class="export-title">导出 Excel</h3>
        <p class="excel-export-tip">正在导出档案信息，请稍候…</p>
      </div>
    </div>

    <div v-if="exportState.visible" class="export-mask">
      <div class="export-dialog">
        <h3 class="export-title">导出 PDF</h3>
        <p class="export-dir" :title="exportState.dir">输出目录：{{ exportState.dir }}</p>

        <div class="export-stats">
          <div class="export-stat">
            <span class="export-value">{{ exportState.total }}</span>
            <span class="export-label">总共</span>
          </div>
          <div class="export-stat">
            <span class="export-value">{{ exportState.done }}</span>
            <span class="export-label">已完成</span>
          </div>
          <div class="export-stat">
            <span class="export-value">{{ exportState.remaining }}</span>
            <span class="export-label">还有</span>
          </div>
        </div>

        <div class="export-track">
          <div class="export-bar" :style="{ width: `${exportPercent}%` }"></div>
        </div>

        <p class="export-current">
          <template v-if="exportState.finished">
            {{
              exportState.message ||
              (exportState.failed ? `${exportState.failed} 个档案导出失败` : '全部档案已导出完成')
            }}
          </template>
          <template v-else-if="exportState.current">
            正在导出「{{ exportState.current }}」<template v-if="exportState.images">
              · {{ exportState.images }} 张图像</template
            >
          </template>
          <template v-else>正在准备...</template>
        </p>

        <ul v-if="exportState.finished && exportState.failures.length" class="export-failures">
          <li v-for="item in exportState.failures" :key="item.name">
            「{{ item.name }}」{{ item.message }}
          </li>
        </ul>

        <div class="export-foot">
          <button
            class="btn btn-sm"
            type="button"
            :disabled="!exportState.finished"
            @click="closeExportModal"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-body {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.archive-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.archive-toolbar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.archive-toolbar .btn {
  flex: 1;
}

.archive-toolbar .btn:disabled {
  cursor: not-allowed;
  border-color: var(--color-border-strong);
  color: var(--color-text-3);
}

.archive-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface-soft);
}

.archive-form .input {
  width: 100%;
}

.archive-form-foot {
  display: flex;
  gap: 8px;
}

.archive-form-foot .btn {
  flex: 1;
}

.archive-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 560px;
  padding: 10px;
  overflow-y: auto;
}

.archive-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px dashed transparent;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-text-2);
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.archive-item:hover {
  background-color: var(--color-surface-soft);
  color: var(--color-text-1);
}

.archive-item.active {
  background-color: var(--color-primary-soft);
  font-weight: 500;
  color: var(--color-primary);
}

.archive-item.drop-target {
  border-color: var(--color-primary);
  background-color: var(--color-primary-soft);
  color: var(--color-primary);
}

.archive-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  background-color: var(--color-surface);
  font-size: 13px;
  color: var(--color-text-1);
  outline: none;
}

.archive-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.archive-count {
  flex-shrink: 0;
  min-width: 22px;
  padding: 0 6px;
  border-radius: 9px;
  background-color: var(--color-surface-soft);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--color-text-3);
}

.archive-item.active .archive-count {
  background-color: var(--color-surface);
  color: var(--color-primary);
}

.batch-select {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-label {
  font-size: 12px;
  color: var(--color-text-3);
  white-space: nowrap;
}

.batch-input {
  width: 220px;
  height: 32px;
  font-size: 13px;
}

.view-switch {
  display: flex;
  padding: 2px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
}

.view-switch button {
  height: 28px;
  padding: 0 12px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text-2);
  transition:
    color 0.18s ease,
    background-color 0.18s ease;
}

.view-switch button.active {
  background-color: var(--color-primary);
  color: #fff;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-subgroup {
  display: flex;
  align-items: center;
}

.action-subgroup .btn {
  border-radius: 0;
}

.action-subgroup .btn + .btn {
  margin-left: -1px;
}

.action-subgroup .btn:first-child {
  border-top-left-radius: var(--radius-sm);
  border-bottom-left-radius: var(--radius-sm);
}

.action-subgroup .btn:last-child {
  border-top-right-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}

.action-subgroup .btn:hover {
  position: relative;
  z-index: 1;
}

.action-group .btn-icon {
  width: 36px;
  padding: 0;
}

.action-group .btn-icon svg {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.action-group .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.summary {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.empty-hint {
  margin-top: 6px;
  font-size: 12px;
}

.thumb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 16px;
  padding: 20px;
}

.thumb-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease;
}

.thumb-card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-card);
}

.thumb-card.selected {
  border-color: var(--color-primary);
  background-color: var(--color-primary-soft);
  box-shadow: var(--shadow-card);
}

.thumb-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 150px;
  padding: 10px;
  overflow: hidden;
  background-color: var(--color-surface-soft);
  background-image:
    linear-gradient(45deg, #eef1f5 25%, transparent 25%),
    linear-gradient(-45deg, #eef1f5 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eef1f5 75%),
    linear-gradient(-45deg, transparent 75%, #eef1f5 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  user-select: none;
}

.thumb-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  -webkit-user-drag: none;
}

.thumb-edit-btn {
  position: absolute;
  bottom: 8px;
  left: 50%;
  padding: 3px 10px;
  border-radius: 11px;
  background-color: rgba(37, 99, 235, 0.92);
  font-size: 11px;
  color: #fff;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 6px);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.thumb-card:hover .thumb-edit-btn,
.thumb-card.selected .thumb-edit-btn {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0);
}

.thumb-meta {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--color-border);
}

.thumb-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumb-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-3);
}

.col-preview {
  width: 72px;
}

.image-row {
  cursor: pointer;
  user-select: none;
}

.table .image-row.selected td {
  background-color: var(--color-primary-soft);
}

.image-row.selected .col-name {
  color: var(--color-primary);
  font-weight: 500;
}

.mini-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 3px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-soft);
}

.mini-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  -webkit-user-drag: none;
}

.col-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-1);
}

.col-path {
  max-width: 320px;
  overflow: hidden;
  font-size: 12px;
  color: var(--color-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-actions {
  white-space: nowrap;
}

.link-btn {
  padding: 0 6px;
  font-size: 13px;
  color: var(--color-primary);
}

.link-btn:hover {
  text-decoration: underline;
}

.link-btn.danger {
  color: var(--color-danger);
}

.export-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(15, 23, 42, 0.45);
}

.export-dialog {
  width: 380px;
  padding: 20px 22px 18px;
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.24);
}

.export-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-1);
}

.excel-dialog {
  width: 320px;
}

.excel-export-tip {
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-text-2);
}

.export-dir {
  margin-top: 6px;
  overflow: hidden;
  font-size: 12px;
  color: var(--color-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-field {
  margin-top: 16px;
}

.export-field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2);
}

.export-radios {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.export-radio {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-1);
}

.export-radio input {
  margin-top: 2px;
  accent-color: var(--color-primary);
}

.export-radio em {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-style: normal;
  color: var(--color-text-3);
}

.export-folder {
  display: flex;
  align-items: center;
  gap: 8px;
}

.export-folder-path {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-soft);
  font-size: 12px;
  color: var(--color-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-folder-path.is-empty {
  color: var(--color-text-3);
}

.export-stats {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.export-stat {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 0;
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-soft);
}

.export-value {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-1);
}

.export-label {
  font-size: 11px;
  color: var(--color-text-3);
}

.export-track {
  height: 8px;
  margin-top: 14px;
  overflow: hidden;
  border-radius: 4px;
  background-color: var(--color-surface-soft);
}

.export-bar {
  height: 100%;
  background-color: var(--color-primary);
  transition: width 0.2s ease;
}

.export-current {
  min-height: 20px;
  margin-top: 10px;
  overflow: hidden;
  font-size: 12px;
  color: var(--color-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.export-foot-actions {
  gap: 8px;
}

.export-failures {
  max-height: 120px;
  margin: 8px 0 0;
  padding-left: 16px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-danger);
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
  }

  .page-body {
    grid-template-columns: 1fr;
  }
}
</style>
