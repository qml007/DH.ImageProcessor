<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

interface AiServiceOption {
  aiId: string
  name: string
  model: string
  supportsVision: number
  isDefault: number
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}

const MAX_IMAGES = 4

const services = ref<AiServiceOption[]>([])
const selectedAiId = ref('')
const loadingServices = ref(true)
const loadError = ref('')

const messages = ref<ChatMessage[]>([])
const input = ref('')
const pendingImages = ref<string[]>([])
const streaming = ref(false)
const error = ref('')
const scrollRef = ref<HTMLElement | null>(null)

let activeRequestId = ''
let removeListener: (() => void) | null = null
/** 本次页面产生的临时图片，关闭页面时一并清理 */
const tempRelPaths: string[] = []

const currentService = computed(
  () => services.value.find((service) => service.aiId === selectedAiId.value) ?? null
)
const visionEnabled = computed(() => currentService.value?.supportsVision === 1)
const canSend = computed(
  () =>
    !streaming.value &&
    Boolean(currentService.value) &&
    (input.value.trim().length > 0 || pendingImages.value.length > 0)
)

const scrollToBottom = (): void => {
  void nextTick(() => {
    const container = scrollRef.value
    if (container) container.scrollTop = container.scrollHeight
  })
}

const isThinking = (index: number): boolean =>
  streaming.value &&
  index === messages.value.length - 1 &&
  messages.value[index].role === 'assistant' &&
  messages.value[index].content === ''

const loadServices = async (): Promise<void> => {
  loadingServices.value = true
  loadError.value = ''
  try {
    const result = await window.api.listAiSettingInfo()
    if (!result.ok) {
      loadError.value = result.message ?? '加载 AI 服务失败'
      return
    }
    services.value = (result.items ?? []).map((item) => ({
      aiId: item.aiId,
      name: item.name,
      model: item.model,
      supportsVision: item.supportsVision,
      isDefault: item.isDefault
    }))

    if (!services.value.some((service) => service.aiId === selectedAiId.value)) {
      selectedAiId.value = services.value[0]?.aiId ?? ''
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    loadingServices.value = false
  }
}

const handleStreamEvent = (event: {
  requestId: string
  type: 'delta' | 'done' | 'error'
  delta?: string
  message?: string
}): void => {
  if (!activeRequestId || event.requestId !== activeRequestId) return

  if (event.type === 'delta' && event.delta) {
    const target = messages.value[messages.value.length - 1]
    if (target?.role === 'assistant') {
      target.content += event.delta
      scrollToBottom()
    }
    return
  }

  if (event.type === 'error') {
    const target = messages.value[messages.value.length - 1]
    if (target?.role === 'assistant' && !target.content) messages.value.pop()
    error.value = event.message ?? 'AI 响应失败'
  }

  streaming.value = false
  activeRequestId = ''
}

const clearTempImages = (): void => {
  if (!tempRelPaths.length) return
  void window.api.deleteTempImages({ paths: [...tempRelPaths] })
  tempRelPaths.length = 0
}

const abortStream = (): void => {
  if (!activeRequestId) return
  window.api.aiChatAbort({ requestId: activeRequestId })
  activeRequestId = ''
  streaming.value = false
}

const send = async (): Promise<void> => {
  if (!canSend.value || !currentService.value) return

  const text = input.value.trim()
  const images = visionEnabled.value ? [...pendingImages.value] : []

  error.value = ''
  messages.value.push({ role: 'user', content: text, images })
  input.value = ''
  pendingImages.value = []
  messages.value.push({ role: 'assistant', content: '' })
  scrollToBottom()

  const payloadMessages = messages.value.slice(0, -1).map((message) => ({
    role: message.role,
    content: message.content,
    images: visionEnabled.value && message.images?.length ? message.images : undefined
  }))

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  activeRequestId = requestId
  streaming.value = true

  try {
    const result = await window.api.aiChatStart({
      requestId,
      aiId: selectedAiId.value,
      messages: payloadMessages
    })

    if (!result.ok) {
      error.value = result.message ?? '无法开始对话'
      messages.value.pop()
      streaming.value = false
      activeRequestId = ''
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '未知错误'
    messages.value.pop()
    streaming.value = false
    activeRequestId = ''
  }
}

const pickImages = async (): Promise<void> => {
  if (!visionEnabled.value || streaming.value) return

  const remaining = MAX_IMAGES - pendingImages.value.length
  if (remaining <= 0) {
    error.value = `每条消息最多上传 ${MAX_IMAGES} 张图片`
    return
  }

  try {
    const result = await window.api.openImages()
    if (result.canceled) return

    for (const file of (result.images ?? []).slice(0, remaining)) {
      // 图片临时落到设置的临时文件夹，页面关闭后不再保留
      const saved = await window.api.saveAiChatImage({ dataUrl: file.dataUrl })
      if (!saved.ok) {
        error.value = saved.message ?? '临时保存图片失败'
        continue
      }
      if (saved.relPath) tempRelPaths.push(saved.relPath)
      pendingImages.value.push(file.dataUrl)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '选择图片失败'
  }
}

const removePendingImage = (index: number): void => {
  pendingImages.value.splice(index, 1)
}

const newChat = (): void => {
  abortStream()
  clearTempImages()
  messages.value = []
  pendingImages.value = []
  input.value = ''
  error.value = ''
}

watch(selectedAiId, () => {
  if (streaming.value) abortStream()
  clearTempImages()
  pendingImages.value = []
  error.value = ''
})

onMounted(() => {
  removeListener = window.api.onAiChatEvent(handleStreamEvent)
  void loadServices()
})

onUnmounted(() => {
  // 页面关闭即丢弃本次对话数据
  abortStream()
  clearTempImages()
  removeListener?.()
  removeListener = null
  messages.value = []
  pendingImages.value = []
})
</script>

<template>
  <div class="chat-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">AI对话</h2>
        <p class="page-description">
          与 AI 大模型进行日常对话，支持多轮上下文；对话内容仅保存在当前页面，关闭后即丢弃。
        </p>
      </div>
      <div class="page-actions">
        <select v-model="selectedAiId" class="input service-select" :disabled="!services.length">
          <option v-if="!services.length" value="">暂无可用服务</option>
          <option v-for="service in services" :key="service.aiId" :value="service.aiId">
            {{ service.name }}{{ service.isDefault === 1 ? '（默认）' : '' }}
          </option>
        </select>
        <button class="btn" type="button" :disabled="!messages.length" @click="newChat">
          新对话
        </button>
      </div>
    </div>

    <section class="card chat-card">
      <div v-if="loadingServices" class="empty-state">加载中…</div>

      <div v-else-if="loadError" class="empty-state">{{ loadError }}</div>

      <div v-else-if="!services.length" class="empty-state">
        <p>尚未配置 AI 服务。</p>
        <RouterLink class="btn btn-primary config-link" to="/ai-services"
          >去配置 AI 服务</RouterLink
        >
      </div>

      <template v-else>
        <div ref="scrollRef" class="chat-messages">
          <div v-if="!messages.length" class="chat-welcome">
            <div class="welcome-logo">AI</div>
            <h3>开始一段新的对话</h3>
            <p>
              当前服务：<strong>{{ currentService?.name }}</strong
              >（{{ currentService?.model }}）
              <span v-if="visionEnabled" class="tag tag-success vision-tag">支持图像</span>
              <span v-else class="tag tag-neutral vision-tag">不支持图像</span>
            </p>
            <p class="welcome-hint">
              {{
                visionEnabled ? '可上传图片一起提问。' : '当前服务未开启图像能力，不能上传图片。'
              }}
            </p>
          </div>

          <div
            v-for="(message, index) in messages"
            :key="index"
            class="chat-row"
            :class="message.role"
          >
            <div class="bubble" :class="message.role">
              <div v-if="isThinking(index)" class="typing">
                <span></span><span></span><span></span>
              </div>
              <template v-else>
                <div v-if="message.images?.length" class="bubble-images">
                  <img
                    v-for="(image, imageIndex) in message.images"
                    :key="imageIndex"
                    :src="image"
                    alt="对话图片"
                  />
                </div>
                <p v-if="message.content" class="bubble-text">{{ message.content }}</p>
              </template>
            </div>
          </div>
        </div>

        <p v-if="error" class="chat-error">{{ error }}</p>

        <div class="composer">
          <div v-if="pendingImages.length" class="pending-images">
            <div v-for="(image, index) in pendingImages" :key="index" class="pending-item">
              <img :src="image" alt="待发送图片" />
              <button
                class="remove-image"
                type="button"
                title="移除图片"
                @click="removePendingImage(index)"
              >
                ×
              </button>
            </div>
          </div>

          <div class="composer-row">
            <button
              class="attach-btn"
              type="button"
              :disabled="!visionEnabled || streaming"
              :title="
                visionEnabled
                  ? '上传图片（仅临时保存在临时文件夹）'
                  : '当前 AI 服务未开启图像能力，不能上传图片'
              "
              @click="pickImages"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 12.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" />
                <path d="M3 16l5-5 4 4 3-3 3 3" />
                <path d="M18 15v6" />
                <path d="M15 18h6" />
              </svg>
            </button>

            <textarea
              v-model="input"
              class="composer-input"
              rows="2"
              placeholder="输入消息，Enter 发送，Shift + Enter 换行"
              :disabled="!currentService"
              @keydown.enter.exact.prevent="send"
            ></textarea>

            <button
              class="btn btn-primary send-btn"
              type="button"
              :disabled="!canSend"
              @click="send"
            >
              {{ streaming ? '生成中…' : '发送' }}
            </button>
          </div>

          <p class="composer-hint">
            上下文仅在当前页面保留；上传的图片只临时存放在设置的临时文件夹中。
          </p>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.page-header {
  flex-shrink: 0;
}

.service-select {
  width: 220px;
  cursor: pointer;
}

.config-link {
  margin-top: 12px;
}

.chat-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-welcome {
  margin: auto;
  text-align: center;
  color: var(--color-text-2);
}

.welcome-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background-color: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 16px;
  font-weight: 600;
}

.chat-welcome h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-1);
}

.chat-welcome p {
  margin-top: 6px;
  font-size: 13px;
}

.vision-tag {
  margin-left: 6px;
}

.welcome-hint {
  color: var(--color-text-3);
}

.chat-row {
  display: flex;
}

.chat-row.user {
  justify-content: flex-end;
}

.chat-row.assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 13px;
  line-height: 1.65;
}

.bubble.user {
  background-color: var(--color-primary-soft);
  color: var(--color-text-1);
  border-top-right-radius: 3px;
}

.bubble.assistant {
  background-color: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  color: var(--color-text-1);
  border-top-left-radius: 3px;
}

.bubble-text {
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.bubble-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.bubble-images img {
  max-width: 180px;
  max-height: 140px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  object-fit: contain;
}

.typing {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
}

.typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-text-3);
  animation: typing-bounce 1.1s infinite ease-in-out;
}

.typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes typing-bounce {
  0%,
  70%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  35% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.chat-error {
  flex-shrink: 0;
  padding: 8px 20px;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-danger-soft);
  font-size: 12px;
  color: var(--color-danger);
}

.composer {
  flex-shrink: 0;
  padding: 12px 16px 10px;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-surface);
}

.pending-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.pending-item {
  position: relative;
}

.pending-item img {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  object-fit: cover;
}

.remove-image {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: rgba(15, 23, 42, 0.7);
  color: #fff;
  font-size: 12px;
  line-height: 1;
}

.remove-image:hover {
  background-color: var(--color-danger);
}

.composer-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.attach-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text-2);
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.attach-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.attach-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.attach-btn svg {
  width: 17px;
  height: 17px;
}

.composer-input {
  flex: 1;
  min-width: 0;
  min-height: 34px;
  max-height: 160px;
  padding: 7px 12px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.composer-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.send-btn {
  flex-shrink: 0;
}

.send-btn:disabled,
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.composer-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-3);
}
</style>
