<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { imageStore, type Archive, type EditableImage } from '../stores/imageStore'
import type {
  OpenImagesResult,
  PdfExportArchive,
  PdfExportArchiveResult,
  PdfExportFailure,
  PdfExportProgress
} from '../../../preload/index.d'
import { formatSize } from '../utils/format'
import { isPdfReadyDataUrl, toPdfJpegDataUrl } from '../utils/image'

const router = useRouter()

const images = computed(() => imageStore.images)
const archives = computed(() => imageStore.archives)
const activeArchiveId = computed(() => imageStore.activeArchiveId)
const activeArchiveName = computed(() => imageStore.activeArchive?.name ?? '')
const viewMode = ref<'grid' | 'list'>('grid')
const loading = ref(false)
const message = ref('')

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
  archives.value.filter(
    (item) => item.id !== imageStore.defaultArchiveId && imageStore.countOf(item.id) > 0
  )
)

const totalSize = computed(() => images.value.reduce((sum, item) => sum + item.size, 0))

const flashMessage = (text: string): void => {
  message.value = text
  window.setTimeout(() => {
    message.value = ''
  }, 2500)
}

const applyImported = (result: OpenImagesResult): void => {
  if (result.message) {
    flashMessage(result.message)
    return
  }

  const { added, skipped } = imageStore.add(result.images)

  if (!added) {
    flashMessage(skipped ? `所选图片均已导入，跳过 ${skipped} 张` : '未读取到可用的图片')
    return
  }

  flashMessage(
    skipped ? `已导入 ${added} 张，跳过 ${skipped} 张重复图片` : `已导入 ${added} 张图片`
  )
}

const importImages = async (): Promise<void> => {
  loading.value = true
  try {
    const result = await window.api.openImages()
    if (result.canceled) return
    applyImported(result)
  } catch (error) {
    console.error(error)
    flashMessage('导入失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const importFolder = async (): Promise<void> => {
  loading.value = true
  try {
    const result = await window.api.openImageFolder()
    if (result.canceled) return
    applyImported(result)
  } catch (error) {
    console.error(error)
    flashMessage('导入失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const editImage = (target: EditableImage): void => {
  router.push({ name: 'image-edit', params: { id: target.id } })
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

  exportState.current = ''
  exportState.finished = true
  exportState.failed = progress.failures ?? 0
}

const prepareArchiveImages = async (archiveId: string): Promise<string[]> => {
  const source = imageStore.imagesOf(archiveId)
  const prepared: string[] = []

  for (const image of source) {
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

  return prepared
}

const retrySkippedImages = async (
  dir: string,
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
        archives: [{ name: source.name, fileName: current.fileName, images }]
      })

      if (retried.results[0]) merged[index] = retried.results[0]
    } catch (error) {
      console.error('Failed to retry PDF export:', error)
    }
  }

  return merged
}

const exportPdf = async (): Promise<void> => {
  if (exporting.value) return

  const targets = exportTargets.value
  if (!targets.length) {
    flashMessage('没有可导出的档案，请先把图像移到「默认档案」之外的档案中')
    return
  }

  let folder: Awaited<ReturnType<typeof window.api.selectPdfFolder>>

  try {
    folder = await window.api.selectPdfFolder()
  } catch (error) {
    console.error(error)
    flashMessage('选择文件夹失败，请稍后重试')
    return
  }

  if (folder.canceled || !folder.dir) return

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
    dir: folder.dir,
    failures: []
  })

  try {
    const archives: PdfExportArchive[] = []

    for (const item of targets) {
      archives.push({ name: item.name, images: await prepareArchiveImages(item.id) })
    }

    const payload = { dir: folder.dir, archives }
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

    const finalResults = await retrySkippedImages(folder.dir, archives, result.results)
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

const removeImage = (target: EditableImage): void => {
  imageStore.remove(target.id)
  selectedIds.value = selectedIds.value.filter((item) => item !== target.id)

  if (markAnchorId.value === target.id) {
    markAnchorId.value = null
    clearSelection()
  }

  if (currentImageId.value === target.id) currentImageId.value = null
}

const clearAll = (): void => {
  imageStore.clear()
  clearSelection()
  resetMark()
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

const finishRangeMark = (): void => {
  const ids = markAnchorId.value
    ? rangeIds(markAnchorId.value, currentImageId.value ?? markAnchorId.value)
    : [...selectedIds.value]

  const targets = ids.filter((id) => images.value.some((item) => item.id === id))
  if (!targets.length) {
    flashMessage('没有可归档的图像，请先选中图像（F7 标记起点，F8 完成）')
    return
  }

  const previousArchiveId = activeArchiveId.value
  const archive = imageStore.addArchive('')
  const moved = imageStore.moveImages(targets, archive.id)

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

const confirmCreateArchive = (): void => {
  const archive = imageStore.addArchive(newArchiveName.value)
  cancelCreateArchive()
  flashMessage(`已新增档案「${archive.name}」`)
}

const selectArchive = (id: string): void => {
  if (id === activeArchiveId.value) return
  imageStore.selectArchive(id)
  clearSelection()
  resetMark()
}

const deleteArchive = (): void => {
  if (archives.value.length <= 1) {
    flashMessage('至少需要保留一个档案')
    return
  }

  const name = activeArchiveName.value
  const removed = imageStore.removeArchive(activeArchiveId.value)

  clearSelection()
  resetMark()
  flashMessage(removed ? `已删除档案「${name}」` : '删除失败，请稍后重试')
}

const startRenameArchive = (archive: Archive): void => {
  editingArchiveId.value = archive.id
  editingArchiveName.value = archive.name
}

const cancelRenameArchive = (): void => {
  editingArchiveId.value = null
  editingArchiveName.value = ''
}

const confirmRenameArchive = (): void => {
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

  if (!imageStore.renameArchive(id, name)) {
    flashMessage(`档案「${name}」已存在，请换一个名称`)
    return
  }

  cancelRenameArchive()
  flashMessage(`已重命名为「${name}」`)
}

const setRenameInput = (el: unknown): void => {
  const input = (el as HTMLInputElement | null) ?? null
  if (!input) return

  input.focus()
  input.select()
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

const onArchiveDrop = (archiveId: string, event: DragEvent): void => {
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

  const moved = imageStore.moveImages(ids, archiveId)
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
          结束并移入新档案；双击图像或点击「点击进入编辑」进入编辑页面。
        </p>
      </div>
      <div class="page-actions">
        <div class="view-switch">
          <button type="button" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
            缩略图
          </button>
          <button type="button" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">
            列表
          </button>
        </div>
        <button class="btn" type="button" :disabled="!images.length" @click="clearAll">清空</button>
        <button class="btn btn-primary" type="button" :disabled="loading" @click="importImages">
          {{ loading ? '读取中...' : '导入图像' }}
        </button>
        <button class="btn" type="button" :disabled="loading" @click="importFolder">
          {{ loading ? '读取中...' : '导入文件夹' }}
        </button>
        <button
          class="btn"
          type="button"
          :disabled="exporting || !exportTargets.length"
          :title="exportTargets.length ? '按档案导出 PDF' : '请先把图像移到默认档案之外'"
          @click="exportPdf"
        >
          {{ exporting ? '导出中...' : '导出 PDF' }}
        </button>
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
          <span v-if="markAnchorId" class="tag tag-warning">
            已标记起点 · 点击结束图像后按 F8 归档
          </span>
          <span v-else-if="selectedIds.length" class="tag tag-primary">
            已选 {{ selectedIds.length }} 张 · 拖到左侧档案可移动
          </span>
          <span v-else-if="message" class="tag tag-success">{{ message }}</span>
        </div>

        <div v-if="!images.length" class="empty-state">
          <p>还没有导入任何图像</p>
          <p class="empty-hint">点击右上角「导入图像」按钮，可一次选择多张图像。</p>
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

.export-dir {
  margin-top: 6px;
  overflow: hidden;
  font-size: 12px;
  color: var(--color-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
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