<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { imageStore, type EditableImage } from '../stores/imageStore'
import { formatSize } from '../utils/format'
import {
  rotateImage,
  deskewImage,
  createPixelSampler,
  samplePixel,
  removeSimilarColor,
  maskRegion,
  centerRegion,
  type PixelSampler,
  type RotationAngle
} from '../utils/image'

const COLOR_TOLERANCE = 60
const MIN_SELECTION_PX = 4

interface EditAction {
  key: string
  label: string
  desc: string
  variant: 'default' | 'danger'
  icon: string[]
}

const route = useRoute()
const router = useRouter()

const image = computed(() => imageStore.find(String(route.params.id)))

const images = computed(() => imageStore.images)

const currentIndex = computed(() =>
  image.value ? images.value.findIndex((item) => item.id === image.value?.id) : -1
)

const prevImage = computed(() =>
  currentIndex.value > 0 ? images.value[currentIndex.value - 1] : undefined
)

const nextImage = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < images.value.length - 1
    ? images.value[currentIndex.value + 1]
    : undefined
)

const positionText = computed(() =>
  currentIndex.value >= 0 ? `第 ${currentIndex.value + 1} 张 / 共 ${images.value.length} 张` : ''
)

const actions: EditAction[] = [
  {
    key: 'rotate-left',
    label: '左旋 90 度',
    desc: '逆时针旋转图片 90°',
    variant: 'default',
    icon: ['M3 5v5h5', 'M3.5 10a8 8 0 1 0 2-5.3']
  },
  {
    key: 'rotate-right',
    label: '右旋 90 度',
    desc: '顺时针旋转图片 90°',
    variant: 'default',
    icon: ['M21 5v5h-5', 'M20.5 10a8 8 0 1 1-2-5.3']
  },
  {
    key: 'auto-correct',
    label: '自动校正倾斜角',
    desc: '自动检测并摆正图片倾斜',
    variant: 'default',
    icon: ['M4 20 20 4', 'M4 4h6', 'M20 20h-6']
  },
  {
    key: 'remove-color',
    label: '去色',
    desc: '吸取颜色，将相近像素置为白色',
    variant: 'default',
    icon: ['M12 3.5c3.6 4 6.2 7.2 6.2 10.5a6.2 6.2 0 1 1-12.4 0c0-3.3 2.6-6.5 6.2-10.5z']
  },
  {
    key: 'discard',
    label: '去除',
    desc: '将所选区域清空为白色',
    variant: 'danger',
    icon: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13', 'M10 11v5', 'M14 11v5']
  },
  {
    key: 'keep',
    label: '保留',
    desc: '仅保留所选区域，其余清空为白色',
    variant: 'default',
    icon: ['M20 6 9 17l-5-5']
  },
  {
    key: 'keep-center',
    label: '保留并居中',
    desc: '仅保留所选区域，并移到图片正中央',
    variant: 'default',
    icon: [
      'M12 3v3.5',
      'M12 17.5v3.5',
      'M3 12h3.5',
      'M17.5 12h3.5',
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
    ]
  }
]

const messageVisible = ref(false)
const messageTitle = ref('')
const messageText = ref('')

const notice = ref('')
const processing = ref(false)

const picking = ref(false)
const sampler = shallowRef<PixelSampler | null>(null)
const hoverColor = ref<{ r: number; g: number; b: number } | null>(null)
const pickerPos = ref({ x: 0, y: 0 })
const stageRef = ref<HTMLElement | null>(null)
const frameRef = ref<HTMLElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

const selection = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const dragging = ref(false)
let dragOrigin: { x: number; y: number } | null = null
let dragStartClient: { x: number; y: number } | null = null

const hasSelection = computed(() => {
  const current = selection.value
  return !!current && current.w > 0 && current.h > 0
})

const selectionStyle = computed(() => {
  const current = selection.value
  if (!current || !hasSelection.value) return null

  return {
    left: `${current.x * 100}%`,
    top: `${current.y * 100}%`,
    width: `${current.w * 100}%`,
    height: `${current.h * 100}%`
  }
})

const selectionSize = computed(() => {
  const current = selection.value
  const img = imgRef.value
  if (!current || !img || !hasSelection.value) return ''
  return `${Math.round(current.w * img.naturalWidth)} × ${Math.round(current.h * img.naturalHeight)}`
})

const clearSelection = (): void => {
  selection.value = null
}

const pointInFrame = (event: MouseEvent): { x: number; y: number } | null => {
  const frame = frameRef.value
  if (!frame) return null

  const rect = frame.getBoundingClientRect()
  if (!rect.width || !rect.height) return null

  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  }
}

const updateSelection = (event: MouseEvent): void => {
  const origin = dragOrigin
  const point = pointInFrame(event)
  if (!origin || !point) return

  selection.value = {
    x: Math.min(origin.x, point.x),
    y: Math.min(origin.y, point.y),
    w: Math.abs(origin.x - point.x),
    h: Math.abs(origin.y - point.y)
  }
}

const endSelect = (event: MouseEvent): void => {
  window.removeEventListener('mousemove', updateSelection)
  window.removeEventListener('mouseup', endSelect)

  const start = dragStartClient
  updateSelection(event)
  dragging.value = false
  dragOrigin = null
  dragStartClient = null

  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < MIN_SELECTION_PX) {
    clearSelection()
  }
}

const startSelect = (event: MouseEvent): void => {
  if (picking.value || processing.value || event.button !== 0) return

  const point = pointInFrame(event)
  if (!point) return

  event.preventDefault()
  dragOrigin = point
  dragStartClient = { x: event.clientX, y: event.clientY }
  dragging.value = true
  selection.value = { x: point.x, y: point.y, w: 0, h: 0 }

  window.addEventListener('mousemove', updateSelection)
  window.addEventListener('mouseup', endSelect)
}

const canUndo = computed(() => (image.value ? image.value.historyIndex > 0 : false))

const canRedo = computed(() => {
  const target = image.value
  if (!target) return false
  return target.historyIndex >= 0 && target.historyIndex < target.history.length - 1
})

const undoHint = computed(() => {
  const target = image.value
  if (!target || !canUndo.value) return '已经是第一步，无法继续恢复'
  return `回到：${target.history[target.historyIndex - 1].label}`
})

const redoHint = computed(() => {
  const target = image.value
  if (!target || !canRedo.value) return '没有可以重做的操作'
  return `前进到：${target.history[target.historyIndex + 1].label}`
})

const undoDisabled = computed(() => processing.value || picking.value || !canUndo.value)

const redoDisabled = computed(() => processing.value || picking.value || !canRedo.value)

const hoverHex = computed(() => {
  const color = hoverColor.value
  if (!color) return ''
  const toHex = (value: number): string => value.toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
})

const hoverRgb = computed(() =>
  hoverColor.value ? `rgb(${hoverColor.value.r}, ${hoverColor.value.g}, ${hoverColor.value.b})` : ''
)

const flashNotice = (text: string): void => {
  notice.value = text
  window.setTimeout(() => {
    notice.value = ''
  }, 2600)
}

const cancelPick = (): void => {
  picking.value = false
  sampler.value = null
  hoverColor.value = null
}

const startPick = async (): Promise<void> => {
  const target = image.value
  if (!target || processing.value) return

  if (picking.value) {
    cancelPick()
    return
  }

  processing.value = true
  try {
    sampler.value = await createPixelSampler(target.dataUrl)
    picking.value = true
    hoverColor.value = null
  } catch (error) {
    console.error(error)
    cancelPick()
    flashNotice('读取图片像素失败，请稍后重试')
  } finally {
    processing.value = false
  }
}

const toPixel = (event: MouseEvent): { x: number; y: number } | null => {
  const img = imgRef.value
  const current = sampler.value
  if (!img || !current) return null

  const rect = img.getBoundingClientRect()
  if (!rect.width || !rect.height) return null

  const x = Math.floor(((event.clientX - rect.left) / rect.width) * current.width)
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * current.height)

  if (x < 0 || y < 0 || x >= current.width || y >= current.height) return null

  return { x, y }
}

const handleCanvasMove = (event: MouseEvent): void => {
  if (!picking.value) return

  const current = sampler.value
  const point = toPixel(event)

  if (!current || !point) {
    hoverColor.value = null
    return
  }

  const color = samplePixel(current, point.x, point.y)
  if (!color) {
    hoverColor.value = null
    return
  }

  hoverColor.value = { r: color.r, g: color.g, b: color.b }

  const stage = stageRef.value
  if (!stage) return

  const stageRect = stage.getBoundingClientRect()
  const boxWidth = 136
  const boxHeight = 84
  const offset = 18

  pickerPos.value = {
    x: Math.min(
      Math.max(8, event.clientX - stageRect.left + offset),
      Math.max(8, stageRect.width - boxWidth - 8)
    ),
    y: Math.min(
      Math.max(8, event.clientY - stageRect.top + offset),
      Math.max(8, stageRect.height - boxHeight - 8)
    )
  }
}

const handleCanvasLeave = (): void => {
  hoverColor.value = null
}

const handleCanvasClick = async (event: MouseEvent): Promise<void> => {
  if (!picking.value || processing.value) return

  const current = sampler.value
  const point = toPixel(event)
  const target = image.value

  if (!current || !point || !target) return

  const color = samplePixel(current, point.x, point.y)
  if (!color) return

  processing.value = true
  try {
    const result = removeSimilarColor(current, color, COLOR_TOLERANCE)

    if (!result.changed) {
      flashNotice('该颜色附近没有可替换的像素，请换一个位置点击')
      return
    }

    const saved = await persistState(
      target,
      result.dataUrl,
      target.rotation,
      `去色 #${color.r.toString(16).padStart(2, '0').toUpperCase()}${color.g
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()}${color.b.toString(16).padStart(2, '0').toUpperCase()}`
    )

    cancelPick()
    flashNotice(
      saved
        ? `已将 ${result.changed} 个相近像素置为白色，结果已保存到临时文件夹`
        : '写入临时文件夹失败，去色结果未生效'
    )
  } catch (error) {
    console.error(error)
    flashNotice('去色失败，请稍后重试')
  } finally {
    processing.value = false
  }
}

const handleKeydown = (event: KeyboardEvent): void => {
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return
  }

  if (event.key === 'Escape') {
    if (picking.value) cancelPick()
    else if (hasSelection.value) clearSelection()
    return
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    goPrev()
    return
  }

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    goNext()
  }
}

const stopDragListeners = (): void => {
  window.removeEventListener('mousemove', updateSelection)
  window.removeEventListener('mouseup', endSelect)
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  stopDragListeners()
})

watch(
  () => route.params.id,
  () => {
    if (picking.value) cancelPick()
    clearSelection()
  }
)

watch(
  () => image.value?.dataUrl,
  () => clearSelection()
)

const goBack = (): void => {
  router.push({ name: 'images' })
}

const openImage = (target?: EditableImage): void => {
  if (!target) return
  router.push({ name: 'image-edit', params: { id: target.id } })
}

const goPrev = (): void => openImage(prevImage.value)

const goNext = (): void => openImage(nextImage.value)

const persistState = async (
  target: EditableImage,
  dataUrl: string,
  rotation: number,
  label: string
): Promise<boolean> => {
  let index = target.historyIndex + 1
  const discarded = target.history.slice(index)

  if (discarded.length) {
    await window.api.deleteTempImages({ paths: discarded.map((item) => item.tempPath) })
  }

  if (index === 0) {
    const base = await window.api.saveTempImage({
      id: target.id,
      dataUrl: target.dataUrl,
      slot: 's0'
    })

    if (!base.ok || !base.path) return false

    imageStore.commitHistory(target.id, {
      tempPath: base.path,
      rotation: target.rotation,
      label: '原始图片'
    })

    index = 1
  }

  const saved = await window.api.saveTempImage({ id: target.id, dataUrl, slot: `s${index}` })
  if (!saved.ok || !saved.path) return false

  imageStore.commitHistory(target.id, { tempPath: saved.path, rotation, label })
  imageStore.update(target.id, { dataUrl })

  return true
}

const restoreState = async (index: number): Promise<void> => {
  const target = image.value
  if (!target || processing.value) return

  const entry = target.history[index]
  if (!entry) return

  if (picking.value) cancelPick()

  processing.value = true
  try {
    const read = await window.api.readTempImage({ path: entry.tempPath })

    if (!read.ok || !read.dataUrl) {
      flashNotice(read.message || '读取临时文件失败，无法恢复该步骤')
      return
    }

    imageStore.update(target.id, {
      dataUrl: read.dataUrl,
      rotation: entry.rotation,
      tempPath: entry.tempPath
    })
    imageStore.moveHistory(target.id, index)

    flashNotice(index === 0 ? '已恢复到原始图片' : `已恢复到：${entry.label}`)
  } catch (error) {
    console.error(error)
    flashNotice('恢复失败，请稍后重试')
  } finally {
    processing.value = false
  }
}

const undo = (): void => {
  const target = image.value
  if (!target || undoDisabled.value) return
  void restoreState(target.historyIndex - 1)
}

const redo = (): void => {
  const target = image.value
  if (!target || redoDisabled.value) return
  void restoreState(target.historyIndex + 1)
}

const rotate = async (angle: RotationAngle): Promise<void> => {
  const target = image.value
  if (!target || processing.value) return

  processing.value = true
  try {
    const rotatedDataUrl = await rotateImage(target.dataUrl, angle)
    const rotation = (target.rotation + angle + 360) % 360
    const done = await persistState(
      target,
      rotatedDataUrl,
      rotation,
      angle > 0 ? '右旋 90°' : '左旋 90°'
    )

    flashNotice(
      done
        ? `已${angle > 0 ? '右' : '左'}旋 90°，结果已保存到临时文件夹`
        : '写入临时文件夹失败，旋转结果未生效'
    )
  } catch (error) {
    console.error(error)
    flashNotice('旋转失败，请稍后重试')
  } finally {
    processing.value = false
  }
}

const autoDeskew = async (): Promise<void> => {
  const target = image.value
  if (!target || processing.value) return

  processing.value = true
  try {
    const result = await deskewImage(target.dataUrl)

    if (!result.changed) {
      flashNotice(`检测到倾斜角 ${Math.abs(result.angle).toFixed(2)}°，未超过 0.5°，无需校正`)
      return
    }

    const correction = Math.abs(result.angle).toFixed(2)
    const rotation = Number(((target.rotation + result.angle + 360) % 360).toFixed(1))
    const done = await persistState(target, result.dataUrl, rotation, `校正倾斜 ${correction}°`)

    flashNotice(
      done
        ? `已校正倾斜角 ${correction}°，结果已保存到临时文件夹`
        : '写入临时文件夹失败，校正结果未生效'
    )
  } catch (error) {
    console.error(error)
    flashNotice('自动校正失败，请稍后重试')
  } finally {
    processing.value = false
  }
}

const applySelection = async (mode: 'remove' | 'keep'): Promise<void> => {
  const target = image.value
  const current = selection.value

  if (!target || processing.value) return

  if (!current || !hasSelection.value) {
    flashNotice('请先在图片上按住鼠标拖拉，选择一个区域')
    return
  }

  processing.value = true
  try {
    const result = await maskRegion(target.dataUrl, current, mode)

    if (!result.changed) {
      flashNotice('所选区域已经是白色，无需处理')
      return
    }

    const label = mode === 'remove' ? '去除选区' : '保留选区'
    const done = await persistState(target, result.dataUrl, target.rotation, label)

    if (!done) {
      flashNotice('写入临时文件夹失败，操作未生效')
      return
    }

    clearSelection()
    flashNotice(
      mode === 'remove'
        ? `已将所选区域清空为白色（${result.changed} 个像素）`
        : `已仅保留所选区域，其余 ${result.changed} 个像素清空为白色`
    )
  } catch (error) {
    console.error(error)
    flashNotice('区域处理失败，请稍后重试')
  } finally {
    processing.value = false
  }
}

const applyCenterSelection = async (): Promise<void> => {
  const target = image.value
  const current = selection.value

  if (!target || processing.value) return

  if (!current || !hasSelection.value) {
    flashNotice('请先在图片上按住鼠标拖拉，选择一个区域')
    return
  }

  processing.value = true
  try {
    const result = await centerRegion(target.dataUrl, current)

    if (!result.changed) {
      flashNotice('所选区域已经位于图片中央，无需处理')
      return
    }

    const done = await persistState(target, result.dataUrl, target.rotation, '保留并居中')

    if (!done) {
      flashNotice('写入临时文件夹失败，操作未生效')
      return
    }

    clearSelection()
    const moves = [
      result.offsetX
        ? `水平${result.offsetX > 0 ? '右' : '左'}移 ${Math.abs(result.offsetX)} 像素`
        : '',
      result.offsetY
        ? `垂直${result.offsetY > 0 ? '下' : '上'}移 ${Math.abs(result.offsetY)} 像素`
        : ''
    ].filter(Boolean)

    flashNotice(
      `已将所选区域移到图片中央${moves.length ? `（${moves.join('、')}）` : ''}，区域外已置为底色`
    )
  } catch (error) {
    console.error(error)
    flashNotice('区域处理失败，请稍后重试')
  } finally {
    processing.value = false
  }
}

const isActionDisabled = (key: string): boolean => {
  if (processing.value) return true

  if (key === 'discard' || key === 'keep' || key === 'keep-center') {
    return picking.value || !hasSelection.value
  }

  return picking.value && key !== 'remove-color'
}

const actionDesc = (action: EditAction): string => {
  if (action.key !== 'discard' && action.key !== 'keep' && action.key !== 'keep-center') {
    return action.desc
  }
  return hasSelection.value
    ? `${action.desc}（已选 ${selectionSize.value} 像素）`
    : '请先在图片上拖拉选择区域'
}

const handleAction = (action: EditAction): void => {
  if (action.key === 'rotate-left') {
    void rotate(-90)
    return
  }

  if (action.key === 'rotate-right') {
    void rotate(90)
    return
  }

  if (action.key === 'auto-correct') {
    void autoDeskew()
    return
  }

  if (action.key === 'remove-color') {
    void startPick()
    return
  }

  if (action.key === 'discard') {
    void applySelection('remove')
    return
  }

  if (action.key === 'keep') {
    void applySelection('keep')
    return
  }

  if (action.key === 'keep-center') {
    void applyCenterSelection()
    return
  }

  messageTitle.value = action.label
  messageText.value = `「${action.label}」功能尚未实现，此处仅弹出提示框。`
  messageVisible.value = true
}
</script>

<template>
  <div>
    <div class="page-header">
      <div class="header-left">
        <button class="btn btn-sm" type="button" @click="goBack">← 返回列表</button>
        <div>
          <h2 class="page-title">{{ image ? image.name : '图片编辑' }}</h2>
          <p class="page-description">调整图片方向与倾斜角度，确认后保留或去除。</p>
        </div>
      </div>
    </div>

    <div v-if="image" class="editor">
      <section class="card canvas-card">
        <div class="card-header">
          <div class="header-meta">
            <h3 class="card-title">图片预览</h3>
            <span v-if="positionText" class="card-subtitle">{{ positionText }}</span>
            <span v-if="notice" class="tag tag-success">{{ notice }}</span>
          </div>
          <span class="tag tag-neutral">{{ image.ext.toUpperCase() }}</span>
        </div>

        <div class="action-bar" :class="{ 'is-busy': processing }">
          <div class="action-group">
            <button
              v-for="action in actions"
              :key="action.key"
              class="action-btn"
              :class="[action.variant, { 'is-active': picking && action.key === 'remove-color' }]"
              type="button"
              :aria-label="action.label"
              :disabled="isActionDisabled(action.key)"
              @click="handleAction(action)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path v-for="d in action.icon" :key="d" :d="d" />
              </svg>
              <span class="action-tip">
                <strong>{{ action.label }}</strong>
                <em>{{ actionDesc(action) }}</em>
              </span>
            </button>
          </div>

          <div class="action-group history-group">
            <button
              class="action-btn"
              type="button"
              aria-label="恢复"
              :disabled="undoDisabled"
              @click="undo"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
              </svg>
              <span class="action-tip">
                <strong>恢复</strong>
                <em>{{ undoHint }}</em>
              </span>
            </button>
            <button
              class="action-btn"
              type="button"
              aria-label="重做"
              :disabled="redoDisabled"
              @click="redo"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M15 14l5-5-5-5" />
                <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 5.5H13" />
              </svg>
              <span class="action-tip">
                <strong>重做</strong>
                <em>{{ redoHint }}</em>
              </span>
            </button>
          </div>
        </div>

        <div class="canvas">
          <button
            class="nav-arrow"
            type="button"
            title="前一图片（← / ↑）"
            :disabled="!prevImage"
            @click="goPrev"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="M15 5 8 12l7 7" />
            </svg>
            <!-- <span class="arrow-label">前一图片</span> -->
          </button>

          <div ref="stageRef" class="canvas-stage" :class="{ picking }">
            <div ref="frameRef" class="stage-frame" @mousedown="startSelect">
              <img
                ref="imgRef"
                :src="image.dataUrl"
                :alt="image.name"
                draggable="false"
                @mousemove="handleCanvasMove"
                @mouseleave="handleCanvasLeave"
                @click="handleCanvasClick"
              />

              <div v-if="selectionStyle" class="selection-box" :style="selectionStyle">
                <span v-if="dragging" class="selection-size">{{ selectionSize }}</span>
              </div>
            </div>

            <div v-if="picking" class="pick-hint">
              <span class="pick-dot" :style="{ backgroundColor: hoverRgb || 'transparent' }"></span>
              <span class="pick-text">
                {{
                  hoverColor ? '点击即将该颜色替换为白色' : '在图片上移动鼠标，选中要置为白色的颜色'
                }}
              </span>
              <button class="btn btn-sm" type="button" @click="cancelPick">取消</button>
            </div>

            <div
              v-if="picking && hoverColor"
              class="color-picker"
              :style="{ left: `${pickerPos.x}px`, top: `${pickerPos.y}px` }"
            >
              <span class="color-swatch" :style="{ backgroundColor: hoverRgb }"></span>
              <div class="color-values">
                <strong>{{ hoverHex }}</strong>
                <em>{{ hoverRgb }}</em>
              </div>
            </div>
          </div>

          <button
            class="nav-arrow"
            type="button"
            title="后一图片（→ / ↓）"
            :disabled="!nextImage"
            @click="goNext"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
            <!-- <span class="arrow-label">后一图片</span> -->
          </button>
        </div>
      </section>

      <aside class="card side-panel">
        <div class="card-header">
          <h3 class="card-title">图片信息</h3>
        </div>

        <div class="card-body">
          <ul class="meta-list">
            <li>
              <span>文件名</span>
              <strong :title="image.name">{{ image.name }}</strong>
            </li>
            <li>
              <span>格式</span>
              <strong>{{ image.ext.toUpperCase() }}</strong>
            </li>
            <li>
              <span>大小</span>
              <strong>{{ formatSize(image.size) }}</strong>
            </li>
            <li>
              <span>路径</span>
              <strong :title="image.path">{{ image.path }}</strong>
            </li>
            <li>
              <span>旋转角度</span>
              <strong>{{ image.rotation }}°</strong>
            </li>
            <li>
              <span>临时文件</span>
              <strong :title="image.tempPath || '尚未生成'">{{
                image.tempPath || '尚未生成'
              }}</strong>
            </li>
          </ul>
        </div>
      </aside>
    </div>

    <section v-else class="card">
      <p class="empty-state">未找到该图片，可能已被移除。</p>
      <div class="empty-actions">
        <button class="btn btn-primary" type="button" @click="goBack">返回列表</button>
      </div>
    </section>

    <div v-if="messageVisible" class="message-mask" @click.self="messageVisible = false">
      <div class="message-box">
        <div class="message-head">
          <h3 class="card-title">{{ messageTitle }}</h3>
          <button class="close-btn" type="button" @click="messageVisible = false">×</button>
        </div>
        <div class="message-body">{{ messageText }}</div>
        <div class="message-foot">
          <button class="btn btn-primary" type="button" @click="messageVisible = false">
            知道了
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header-left {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.header-left .btn {
  flex-shrink: 0;
  margin-top: 2px;
}

.editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.canvas-card {
  display: flex;
  flex-direction: column;
}

.header-meta {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.canvas {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 460px;
  padding: 16px;
  background-color: var(--color-surface-soft);
}

.canvas-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  min-height: 428px;
  padding: 20px;
  border-radius: var(--radius-sm);
  background-image:
    linear-gradient(45deg, #eef1f5 25%, transparent 25%),
    linear-gradient(-45deg, #eef1f5 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eef1f5 75%),
    linear-gradient(-45deg, transparent 75%, #eef1f5 75%);
  background-size: 18px 18px;
  background-position:
    0 0,
    0 9px,
    9px -9px,
    -9px 0;
}

.stage-frame {
  position: relative;
  display: flex;
  max-width: 100%;
  max-height: 62vh;
  line-height: 0;
  cursor: crosshair;
  user-select: none;
}

.canvas-stage img {
  max-width: 100%;
  max-height: 62vh;
  object-fit: contain;
  background-color: #fff;
  box-shadow: 0 8px 24px -12px rgba(15, 23, 42, 0.3);
  -webkit-user-drag: none;
}

.canvas-stage.picking img {
  cursor: crosshair;
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
}

.selection-box {
  position: absolute;
  border: 1px dashed var(--color-primary);
  background-color: rgba(37, 99, 235, 0.14);
  pointer-events: none;
}

.selection-size {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(15, 23, 42, 0.82);
  color: #fff;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}

.pick-hint {
  position: absolute;
  top: 10px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 24px);
  padding: 6px 8px 6px 12px;
  border: 1px solid var(--color-primary);
  border-radius: 18px;
  background-color: rgba(255, 255, 255, 0.96);
  box-shadow: 0 6px 18px -10px rgba(15, 23, 42, 0.4);
  font-size: 12px;
  color: var(--color-text-2);
  transform: translateX(-50%);
  white-space: nowrap;
}

.pick-dot {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border: 1px solid var(--color-border-strong);
  border-radius: 50%;
  background-image: none;
}

.pick-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-hint .btn {
  flex-shrink: 0;
  height: 22px;
  padding: 0 10px;
  font-size: 12px;
}

.color-picker {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 136px;
  padding: 6px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: rgba(255, 255, 255, 0.97);
  box-shadow: 0 8px 20px -8px rgba(15, 23, 42, 0.45);
  pointer-events: none;
}

.color-swatch {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: 1px solid var(--color-border-strong);
  border-radius: 4px;
}

.color-values {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.color-values strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-1);
  font-variant-numeric: tabular-nums;
}

.color-values em {
  overflow: hidden;
  font-size: 11px;
  font-style: normal;
  color: var(--color-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-direction: column;
  flex-shrink: 0;
  width: 52px;
  height: 76px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  color: var(--color-text-2);
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background-color 0.18s ease;
}

.nav-arrow svg {
  width: 22px;
  height: 22px;
}

.arrow-label {
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.nav-arrow:hover:not(:disabled) {
  border-color: var(--color-primary);
  background-color: var(--color-primary-soft);
  color: var(--color-primary);
}

.nav-arrow:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.meta-list {
  display: flex;
  flex-direction: column;
}

.meta-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--color-border);
  font-size: 13px;
}

.meta-list li span {
  flex-shrink: 0;
  color: var(--color-text-3);
}

.meta-list li strong {
  overflow: hidden;
  font-weight: 500;
  color: var(--color-text-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-bar {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-surface);
}

.action-group {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
}

.history-group {
  margin-left: 6px;
}

.action-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 34px;
  padding: 0;
  border: none;
  border-right: 1px solid var(--color-border);
  background-color: transparent;
  color: var(--color-text-2);
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.action-btn:first-child {
  border-top-left-radius: var(--radius-sm);
  border-bottom-left-radius: var(--radius-sm);
}

.action-btn:last-child {
  border-right: none;
  border-top-right-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}

.action-btn svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.action-btn:hover:not(:disabled) {
  background-color: var(--color-primary-soft);
  color: var(--color-primary);
}

.action-btn:disabled {
  cursor: not-allowed;
  color: var(--color-text-3);
}

.action-btn:disabled svg {
  opacity: 0.55;
}

.action-bar.is-busy .action-btn:disabled {
  cursor: progress;
}

.action-btn.is-active {
  background-color: var(--color-primary-soft);
  color: var(--color-primary);
}

.action-btn.danger:hover:not(:disabled) {
  background-color: var(--color-danger-soft);
  color: var(--color-danger);
}

.action-tip {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border-radius: 6px;
  background-color: rgba(17, 24, 39, 0.95);
  box-shadow: 0 10px 24px -12px rgba(15, 23, 42, 0.6);
  color: #fff;
  line-height: 1.35;
  text-align: left;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transform: translateX(-50%) translateY(-4px);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    visibility 0.16s ease;
  pointer-events: none;
}

.action-tip::before {
  position: absolute;
  top: -4px;
  left: 50%;
  width: 8px;
  height: 8px;
  background-color: rgba(17, 24, 39, 0.95);
  transform: translateX(-50%) rotate(45deg);
  content: '';
}

.action-tip strong {
  font-size: 12px;
  font-weight: 600;
}

.action-tip em {
  font-size: 11px;
  font-style: normal;
  opacity: 0.75;
}

.action-btn:first-child .action-tip {
  left: 0;
  transform: translateX(0) translateY(-4px);
}

.action-btn:first-child .action-tip::before {
  left: 20px;
  transform: rotate(45deg);
}

.action-btn:last-child .action-tip {
  right: 0;
  left: auto;
  transform: translateX(0) translateY(-4px);
}

.action-btn:last-child .action-tip::before {
  right: 20px;
  left: auto;
  transform: rotate(45deg);
}

.action-btn:hover .action-tip,
.action-btn:focus-visible .action-tip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

.action-btn:first-child:hover .action-tip,
.action-btn:first-child:focus-visible .action-tip,
.action-btn:last-child:hover .action-tip,
.action-btn:last-child:focus-visible .action-tip {
  transform: translateX(0) translateY(0);
}

.empty-actions {
  display: flex;
  justify-content: center;
  padding-bottom: 32px;
}

.message-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(15, 23, 42, 0.45);
}

.message-box {
  width: 380px;
  max-width: calc(100% - 40px);
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.35);
}

.message-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
}

.message-body {
  padding: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-2);
}

.message-foot {
  display: flex;
  justify-content: flex-end;
  padding: 0 18px 16px;
}

.close-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  font-size: 18px;
  line-height: 1;
  color: var(--color-text-3);
}

.close-btn:hover {
  background-color: var(--color-surface-soft);
  color: var(--color-text-1);
}

@media (max-width: 1080px) {
  .editor {
    grid-template-columns: 1fr;
  }

  .canvas {
    min-height: 300px;
  }

  .canvas-stage {
    min-height: 268px;
  }
}

@media (max-width: 720px) {
  .arrow-label {
    display: none;
  }

  .nav-arrow {
    width: 38px;
    height: 44px;
  }
}
</style>