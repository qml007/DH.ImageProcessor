<script setup lang="ts">
import { values } from 'pdf-lib'
import { onMounted, reactive, ref } from 'vue'

type AdvancedParamType = 'text' | 'number' | 'boolean'

interface AdvancedParamDraft {
  uid: number
  key: string
  type: AdvancedParamType
  value: string
}

interface AiServiceRow {
  aiId: string
  name: string
  protocol: string
  baseUrl: string
  model: string
  supportsVision: number
  isDefault: number
  advancedParams: Array<{ key: string; type: AdvancedParamType; value: string }>
  apiKeyMasked: string
  hasApiKey: number
}

const protocolOptions = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic 兼容' }
]

const paramTypeOptions: Array<{ value: AdvancedParamType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' }
]

const items = ref<AiServiceRow[]>([])
const loading = ref(false)
const error = ref('')
const flash = ref('')

const modalVisible = ref(false)
const editing = ref<AiServiceRow | null>(null)
const form = reactive({
  name: '',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  supportsVision: 0,
  advancedParams: [] as AdvancedParamDraft[]
})
const advancedOpen = ref(false)
const showApiKey = ref(false)
const formError = ref('')
const submitting = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string; vision: string } | null>(null)

let paramUid = 0
const nextUid = (): number => {
  paramUid += 1
  return paramUid
}

const protocolLabel = (value: string): string =>
  protocolOptions.find((option) => option.value === value)?.label ?? value

const flashMessage = (text: string): void => {
  flash.value = text
  window.setTimeout(() => {
    if (flash.value === text) flash.value = ''
  }, 2500)
}

const loadData = async (): Promise<void> => {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.listAiSettingInfo()
    if (!result.ok) {
      error.value = result.message ?? '加载 AI 服务失败'
      return
    }
    items.value = (result.items ?? []) as AiServiceRow[]
  } catch (e) {
    error.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadData()
})

const resetForm = (): void => {
  form.name = ''
  form.protocol = 'openai'
  form.baseUrl = ''
  form.apiKey = ''
  form.model = ''
  form.supportsVision = 0
  form.advancedParams = []
  advancedOpen.value = false
  showApiKey.value = false
  formError.value = ''
  testResult.value = null
}

const openCreate = (): void => {
  editing.value = null
  resetForm()
  modalVisible.value = true
}

const openEdit = (row: AiServiceRow): void => {
  editing.value = row
  resetForm()
  form.name = row.name
  form.protocol = row.protocol
  form.baseUrl = row.baseUrl
  form.model = row.model
  form.supportsVision = row.supportsVision
  form.advancedParams = row.advancedParams.map((param) => ({
    uid: nextUid(),
    key: param.key,
    type: param.type,
    value: param.value
  }))
  advancedOpen.value = form.advancedParams.length > 0
  modalVisible.value = true
}

const toggleVision = (checked: boolean): void => {
  form.supportsVision = checked ? 1 : 0
}

const addParam = (): void => {
  form.advancedParams.push({ uid: nextUid(), key: '', type: 'text', value: '' })
}

const removeParam = (uid: number): void => {
  form.advancedParams = form.advancedParams.filter((param) => param.uid !== uid)
}

/** 收集高级参数：跳过空 key，并拒绝重复 key */
const collectAdvancedParams = (): Array<{
  key: string
  type: AdvancedParamType
  value: string
}> => {
  const used = new Set<string>()
  const result: Array<{ key: string; type: AdvancedParamType; value: string }> = []

  for (const param of form.advancedParams) {
    const key = param.key.trim()
    if (!key) continue
    if (used.has(key)) throw new Error(`高级参数「${key}」重复`)
    used.add(key)
    result.push({ key, type: param.type, value: param.value })
  }

  return result
}

const validateForm = (): string => {
  if (!form.name.trim()) return '名称不能为空'
  if (!form.baseUrl.trim()) return 'Base URL 不能为空'
  if (!/^https?:\/\/\S+$/i.test(form.baseUrl.trim()))
    return 'Base URL 需以 http:// 或 https:// 开头'
  if (!form.model.trim()) return '模型不能为空'
  if (form.advancedParams.some((param) => !param.key.trim() && param.value.trim()))
    return '高级参数的名称不能为空'
  return ''
}

const submitForm = async (): Promise<void> => {
  if (submitting.value) return

  let advanced: Array<{ key: string; type: AdvancedParamType; value: string }> = []
  try {
    advanced = collectAdvancedParams()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '高级参数无效'
    return
  }

  const invalid = validateForm()
  if (invalid) {
    formError.value = invalid
    return
  }

  submitting.value = true
  formError.value = ''
  try {
    const apiKey = form.apiKey.trim()
    const payload = {
      protocol: form.protocol,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      supportsVision: form.supportsVision,
      advancedParams: advanced
    }

    const result = editing.value
      ? await window.api.updateAiSettingInfo({
          aiId: editing.value.aiId,
          ...payload,
          apiKey: apiKey || undefined
        })
      : await window.api.createAiSettingInfo({
          name: form.name.trim(),
          apiKey,
          ...payload
        })

    if (!result.ok) {
      formError.value = result.message ?? (editing.value ? '保存失败' : '新增失败')
      return
    }

    const saved = editing.value ? '已保存' : '已新增'
    modalVisible.value = false
    await loadData()
    flashMessage(saved)
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    submitting.value = false
  }
}

const testConnection = async (): Promise<void> => {
  if (testing.value) return

  if (!form.baseUrl.trim() || !/^https?:\/\/\S+$/i.test(form.baseUrl.trim())) {
    formError.value = '请先填写有效的 Base URL'
    return
  }
  if (!form.model.trim()) {
    formError.value = '请先填写模型名称'
    return
  }

  let advanced: Array<{ key: string; type: AdvancedParamType; value: string }> = []
  try {
    advanced = collectAdvancedParams()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '高级参数无效'
    return
  }

  testing.value = true
  formError.value = ''
  testResult.value = null
  try {
    const result = await window.api.testAiSettingInfo({
      aiId: editing.value?.aiId,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      supportsVision: form.supportsVision,
      advancedParams: advanced
    })

    testResult.value = {
      ok: result.ok,
      vision: result.vision,
      message: `${result.message}${result.latencyMs ? `（${result.latencyMs} ms）` : ''}`
    }
  } catch (e) {
    testResult.value = {
      ok: false,
      vision: 'not-tested',
      message: e instanceof Error ? e.message : '测试连接失败'
    }
  } finally {
    testing.value = false
  }
}

const setDefault = async (row: AiServiceRow): Promise<void> => {
  if (row.isDefault === 1) return
  try {
    const result = await window.api.setDefaultAiSettingInfo({ aiId: row.aiId })
    if (!result.ok) {
      alert(result.message ?? '设置默认服务失败')
      return
    }
    await loadData()
    flashMessage(`「${row.name}」已设为默认服务`)
  } catch (e) {
    alert(e instanceof Error ? e.message : '未知错误')
  }
}

const removeItem = async (row: AiServiceRow): Promise<void> => {
  const suffix = row.isDefault === 1 ? `（当前默认服务，删除后将自动顺延）` : ''
  if (!confirm(`确定删除 AI 服务「${row.name}」？${suffix}`)) return
  try {
    const result = await window.api.deleteAiSettingInfo({ aiId: row.aiId })
    if (!result.ok) {
      alert(result.message ?? '删除失败')
      return
    }
    await loadData()
    flashMessage('已删除')
  } catch (e) {
    alert(e instanceof Error ? e.message : '未知错误')
  }
}

const testResultClass = (): string => {
  const result = testResult.value
  if (!result) return ''
  if (!result.ok) return 'test-error'
  return result.vision === 'unsupported' ? 'test-warning' : 'test-success'
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">AI服务</h2>
        <p class="page-description">
          管理 AI 大模型的连接参数，可配置多个服务；未被步骤指定的调用使用默认服务。
        </p>
      </div>
      <div class="page-actions">
        <span v-if="flash" class="tag tag-success">{{ flash }}</span>
        <button class="btn btn-primary" type="button" @click="openCreate">新增服务</button>
      </div>
    </div>

    <section class="card">
      <div v-if="loading" class="loading-state">加载中…</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th style="width: 140px">协议</th>
              <th>Base URL</th>
              <th>模型</th>
              <th style="width: 100px">读取图像</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.aiId">
              <td>
                <span class="name-cell">
                  <strong>{{ row.name }}</strong>
                  <span v-if="row.isDefault === 1" class="tag tag-primary">默认</span>
                </span>
              </td>
              <td>
                <span class="tag tag-neutral">{{ protocolLabel(row.protocol) }}</span>
              </td>
              <td class="url-cell" :title="row.baseUrl">{{ row.baseUrl || '—' }}</td>
              <td class="mono-cell">{{ row.model || '—' }}</td>
              <td>
                <span class="tag" :class="row.supportsVision === 1 ? 'tag-success' : 'tag-neutral'">
                  {{ row.supportsVision === 1 ? '支持' : '不支持' }}
                </span>
              </td>
              <td class="col-actions">
                <button class="icon-btn-inline" type="button" title="编辑" @click="openEdit(row)">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
                <button
                  v-if="row.isDefault !== 1"
                  class="icon-btn-inline primary"
                  type="button"
                  title="设为默认"
                  @click="setDefault(row)"
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
                      d="M12 3l2.9 6.3 6.6.8-4.9 4.5 1.3 6.6L12 18l-5.9 3.2 1.3-6.6L2.5 10l6.6-.8z"
                    />
                  </svg>
                </button>
                <button
                  class="icon-btn-inline danger"
                  type="button"
                  title="删除"
                  @click="removeItem(row)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!items.length" class="empty-state">
          尚未配置 AI 服务，点击右上角「新增服务」开始配置。
        </p>
        <p v-else class="table-hint">
          步骤按名称选择服务；未选择的步骤使用默认服务。修改服务只影响新的运行。API
          密钥保存在本机数据库中。
        </p>
      </div>
    </section>

    <div v-if="modalVisible" class="modal-mask" @click.self="modalVisible = false">
      <div class="modal">
        <div class="card-header">
          <h3 class="card-title">{{ editing ? `编辑 ${form.name}` : '新增 AI 服务' }}</h3>
          <button class="close-btn" type="button" @click="modalVisible = false">×</button>
        </div>

        <div class="card-body modal-body">
          <div class="form-row">
            <div class="form-item">
              <label class="form-label" for="ai-name">名称</label>
              <input
                id="ai-name"
                v-model="form.name"
                class="input"
                type="text"
                placeholder="如：local_qwen3_5"
                :disabled="!!editing"
              />
              <p v-if="editing" class="form-hint">不可更改：步骤引用了它。</p>
            </div>
            <div class="form-item">
              <label class="form-label" for="ai-protocol">协议</label>
              <select id="ai-protocol" v-model="form.protocol" class="input">
                <option v-for="option in protocolOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>

          <div class="form-item modal-gap">
            <label class="form-label" for="ai-base-url">Base URL</label>
            <input
              id="ai-base-url"
              v-model="form.baseUrl"
              class="input"
              type="text"
              placeholder="http://localhost:11434/v1"
            />
            <p class="form-hint">
              例如 https://api.openai.com/v1、https://openrouter.ai/api/v1 或
              http://localhost:11434/v1。
            </p>
          </div>

          <div class="form-item modal-gap">
            <label class="form-label" for="ai-api-key">API 密钥</label>
            <div class="key-field">
              <input
                id="ai-api-key"
                v-model="form.apiKey"
                class="input key-input"
                :type="showApiKey ? 'text' : 'password'"
                autocomplete="off"
                :placeholder="
                  editing?.hasApiKey
                    ? `已保存（${editing.apiKeyMasked}），留空则不修改`
                    : '如果服务不需要密钥，请留空'
                "
              />
              <button
                class="key-toggle"
                type="button"
                :title="showApiKey ? '隐藏密钥' : '显示密钥'"
                @click="showApiKey = !showApiKey"
              >
                <svg
                  v-if="showApiKey"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"
                  />
                  <path
                    d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"
                  />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <path d="M1 1l22 22" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            <p class="form-hint">保存在本机数据库中，之后不再显示完整内容。</p>
          </div>

          <div class="form-item modal-gap">
            <label class="form-label" for="ai-model">模型</label>
            <input
              id="ai-model"
              v-model="form.model"
              class="input"
              type="text"
              placeholder="qwen3.5:4b"
            />
            <p class="form-hint">与服务要求完全一致的模型名称。</p>
          </div>

          <div class="form-item modal-gap">
            <label class="check-row">
              <input
                type="checkbox"
                class="check-input"
                :checked="form.supportsVision === 1"
                @change="toggleVision(($event.target as HTMLInputElement).checked)"
              />
              <span class="check-label">模型可以读取图像</span>
            </label>
            <p class="form-hint">
              AI OCR 和提取步骤的“读取页面图像”需要此项。不确定？测试连接会检查。
            </p>
          </div>

          <div class="advanced-block modal-gap">
            <button class="advanced-header" type="button" @click="advancedOpen = !advancedOpen">
              <svg
                class="chevron"
                :class="{ open: advancedOpen }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              <span>高级参数 ({{ form.advancedParams.length }})</span>
            </button>

            <div v-if="advancedOpen" class="advanced-body">
              <p class="form-hint">
                每次请求都会发送，例如 temperature、max_tokens 或
                reasoning_effort。工作流步骤可以覆盖单个参数。
              </p>
              <div v-for="param in form.advancedParams" :key="param.uid" class="param-row">
                <input v-model="param.key" class="input" type="text" placeholder="参数名" />
                <select v-model="param.type" class="input">
                  <option v-for="type in paramTypeOptions" :key="type.value" :value="type.value">
                    {{ type.label }}
                  </option>
                </select>
                <input v-model="param.value" class="input" type="text" placeholder="值" />
                <button
                  class="icon-btn-inline danger"
                  type="button"
                  title="删除参数"
                  @click="removeParam(param.uid)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
              </div>
              <button class="add-param" type="button" @click="addParam">＋ 添加参数</button>
            </div>
          </div>

          <p v-if="formError" class="form-error">{{ formError }}</p>
          <p v-if="testResult" class="test-result" :class="testResultClass()">
            {{ testResult.message }}
          </p>
        </div>

        <div class="modal-footer">
          <button class="btn test-btn" type="button" :disabled="testing" @click="testConnection">
            {{ testing ? '测试中…' : '测试连接' }}
          </button>
          <div class="footer-right">
            <button class="btn" type="button" @click="modalVisible = false">取消</button>
            <button
              class="btn btn-primary"
              type="button"
              :disabled="submitting"
              @click="submitForm"
            >
              {{ submitting ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading-state {
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-3);
}

.name-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.url-cell {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono-cell {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}

.table-hint {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text-3);
}

.col-actions {
  white-space: nowrap;
}

.modal {
  width: 660px;
  max-width: calc(100% - 40px);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 80px);
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.35);
}

.modal-body {
  overflow-y: auto;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(15, 23, 42, 0.45);
}

.modal .card-body {
  padding: 20px;
}

.modal-gap {
  margin-top: 16px;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border);
}

.footer-right {
  display: flex;
  align-items: center;
  gap: 10px;
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

.form-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 16px;
}

.form-error {
  margin-top: 12px;
  font-size: 12px;
  color: var(--color-danger);
}

.key-field {
  position: relative;
}

.key-input {
  width: 100%;
  padding-right: 40px;
}

.key-toggle {
  position: absolute;
  top: 2px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-3);
}

.key-toggle:hover {
  background-color: var(--color-surface-soft);
  color: var(--color-text-1);
}

.key-toggle svg {
  width: 16px;
  height: 16px;
}

.check-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.check-input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.check-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
}

.advanced-block {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.advanced-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  text-align: left;
}

.advanced-header:hover {
  background-color: var(--color-surface-soft);
}

.chevron {
  width: 15px;
  height: 15px;
  color: var(--color-text-3);
  transition: transform 0.15s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.advanced-body {
  padding: 0 12px 12px;
}

.param-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) 96px minmax(0, 1fr) 30px;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.add-param {
  margin-top: 10px;
  padding: 4px 2px;
  font-size: 13px;
  color: var(--color-primary);
}

.add-param:hover {
  text-decoration: underline;
}

.test-result {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.5;
}

.test-success {
  background-color: var(--color-success-soft);
  color: var(--color-success);
}

.test-warning {
  background-color: var(--color-warning-soft);
  color: var(--color-warning);
}

.test-error {
  background-color: var(--color-danger-soft);
  color: var(--color-danger);
}

.test-btn {
  font-weight: 500;
}

.icon-btn-inline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin: 0 2px;
  border-radius: var(--radius-sm);
  color: var(--color-text-2);
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.icon-btn-inline:hover {
  background-color: var(--color-surface-soft);
  color: var(--color-primary);
}

.icon-btn-inline.danger:hover {
  color: var(--color-danger);
  background-color: rgba(239, 68, 68, 0.08);
}

.icon-btn-inline.primary {
  color: var(--color-primary);
}

.icon-btn-inline.primary:hover {
  background-color: var(--color-primary);
  color: #fff;
}

.icon-btn-inline svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
