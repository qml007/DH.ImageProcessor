<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { hotkeyStore } from '../stores/hotkeyStore'
import {
  HOTKEY_CATEGORIES,
  emptyHotkeyConfig,
  eventToAccelerator,
  findConflictRowIds,
  formatAccelerator,
  isReservedAccelerator,
  rowIdOf,
  validateHotkeyConfig,
  type HotkeyConfig
} from '../utils/hotkeys'

const draft = ref<HotkeyConfig>(emptyHotkeyConfig())
const activeCategory = ref(HOTKEY_CATEGORIES[0].key)
const capturingId = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const flash = ref('')

const activeActions = computed(
  () => HOTKEY_CATEGORIES.find((item) => item.key === activeCategory.value)?.actions ?? []
)

const conflictRows = computed(() => findConflictRowIds(draft.value))

const flashMessage = (text: string): void => {
  flash.value = text
  window.setTimeout(() => {
    if (flash.value === text) flash.value = ''
  }, 2500)
}

const draftBinding = (actionKey: string): string =>
  draft.value.categories[activeCategory.value]?.[actionKey] ?? ''

const displayBinding = (actionKey: string): string => formatAccelerator(draftBinding(actionKey))

const setBinding = (actionKey: string, accelerator: string): void => {
  const category = draft.value.categories[activeCategory.value]
  if (!category) return
  category[actionKey] = accelerator
}

const startCapture = (actionKey: string): void => {
  capturingId.value = actionKey
  error.value = ''
}

const stopCapture = (): void => {
  capturingId.value = ''
}

const clearBinding = (actionKey: string): void => {
  setBinding(actionKey, '')
  error.value = ''
}

const handleCaptureKeydown = (actionKey: string, event: KeyboardEvent): void => {
  if (capturingId.value !== actionKey) return

  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    stopCapture()
    return
  }

  const isPlainKey = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey

  if (isPlainKey && (event.key === 'Delete' || event.key === 'Backspace')) {
    clearBinding(actionKey)
    stopCapture()
    return
  }

  const accelerator = eventToAccelerator(event)
  if (!accelerator) return

  if (isReservedAccelerator(accelerator)) {
    error.value = `${formatAccelerator(accelerator)} 是系统保留快捷键（取消选择与上一张/下一张），请更换组合键`
    return
  }

  setBinding(actionKey, accelerator)
  error.value = ''
  stopCapture()
}

const loadDraft = async (): Promise<void> => {
  loading.value = true
  try {
    await hotkeyStore.load()
    draft.value = hotkeyStore.cloneDraft()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadDraft()
})

const save = async (): Promise<void> => {
  if (saving.value) return

  const message = validateHotkeyConfig(draft.value)
  if (message) {
    error.value = message
    return
  }

  saving.value = true
  try {
    const result = await hotkeyStore.save(draft.value)
    if (!result.ok) {
      error.value = result.message ?? '保存快捷键失败'
      return
    }

    draft.value = hotkeyStore.cloneDraft()
    error.value = ''
    flashMessage('快捷键已保存，进入图像编辑页后生效')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存快捷键失败'
  } finally {
    saving.value = false
  }
}

const clearAll = (): void => {
  draft.value = emptyHotkeyConfig()
  error.value = ''
  flashMessage('已清空全部快捷键，点击「保存」后生效')
}

const reload = (): void => {
  void loadDraft()
  error.value = ''
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">自定义快捷键</h2>
        <p class="page-description">
          为图像处理按钮设置应用内快捷键，仅在程序窗口激活且处于图像编辑页时生效。
        </p>
      </div>
      <div class="page-actions">
        <span v-if="flash" class="tag tag-success">{{ flash }}</span>
        <button class="btn" type="button" :disabled="saving" @click="reload">撤销修改</button>
        <button class="btn" type="button" :disabled="saving" @click="clearAll">全部清空</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">保存</button>
      </div>
    </div>

    <section class="card">
      <div class="card-header">
        <div class="hk-tabs">
          <button
            v-for="category in HOTKEY_CATEGORIES"
            :key="category.key"
            class="hk-tab"
            :class="{ active: activeCategory === category.key }"
            type="button"
            @click="activeCategory = category.key"
          >
            {{ category.label }}
          </button>
        </div>
        <p class="card-subtitle">
          点击输入框后按下组合键；Esc 取消录制，Delete / Backspace 清空该项
        </p>
      </div>

      <div class="card-body hk-body">
        <div v-if="loading" class="empty-state">加载中…</div>

        <template v-else>
          <div v-if="error" class="hk-alert">{{ error }}</div>

          <div
            v-for="action in activeActions"
            :key="action.key"
            class="hk-row"
            :class="{ 'has-conflict': conflictRows.has(rowIdOf(activeCategory, action.key)) }"
          >
            <div class="hk-info">
              <strong>{{ action.label }}</strong>
              <span>{{ action.desc }}</span>
            </div>
            <div class="hk-control">
              <input
                class="input hk-input"
                :class="{
                  capturing: capturingId === action.key,
                  filled: !!draftBinding(action.key)
                }"
                type="text"
                readonly
                :value="capturingId === action.key ? '请按下快捷键…' : displayBinding(action.key)"
                placeholder="未设置"
                @click="startCapture(action.key)"
                @keydown="handleCaptureKeydown(action.key, $event)"
                @blur="stopCapture"
              />
              <button
                class="btn btn-sm"
                type="button"
                :disabled="!draftBinding(action.key)"
                @click="clearBinding(action.key)"
              >
                清除
              </button>
            </div>
          </div>

          <p class="hk-hint">
            快捷键统一保存为 CommandOrControl，在 Windows / Linux 对应 Ctrl，在 macOS 对应
            Command；未设置的项不会注册快捷键。
          </p>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hk-tabs {
  display: flex;
  gap: 8px;
}

.hk-tab {
  height: 30px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-soft);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-2);
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background-color 0.18s ease;
}

.hk-tab:hover {
  color: var(--color-primary);
}

.hk-tab.active {
  border-color: var(--color-primary);
  background-color: var(--color-primary-soft);
  color: var(--color-primary);
}

.hk-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-soft);
}

.hk-row.has-conflict {
  border-color: var(--color-danger);
  background-color: var(--color-danger-soft);
}

.hk-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hk-info strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.hk-info span {
  font-size: 12px;
  color: var(--color-text-3);
}

.hk-control {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.hk-input {
  width: 220px;
  text-align: center;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.hk-input.filled {
  font-weight: 600;
  color: var(--color-text-1);
}

.hk-input.capturing {
  border-color: var(--color-primary);
  color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.hk-alert {
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background-color: var(--color-danger-soft);
  font-size: 13px;
  color: var(--color-danger);
}

.hk-hint {
  font-size: 12px;
  color: var(--color-text-3);
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
