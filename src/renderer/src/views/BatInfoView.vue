<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

interface BatInfoRow {
  batId: string
  batCode: string
  arcTypeId: string
  arcTypeName: string
  timeOfCreate: string
  status: number
  sortNo: number
  bgColor: string
  memo: string
}

interface ArcTypeOption {
  typeId: string
  arcTypeCode: string
  arcTypeName: string
}

const items = ref<BatInfoRow[]>([])
const arcTypeOptions = ref<ArcTypeOption[]>([])
const loading = ref(false)
const error = ref('')
const defaultBgColor = ref('#FFFFFF')

const modalVisible = ref(false)
const editing = ref<BatInfoRow | null>(null)
const form = reactive({
  arcTypeId: '',
  status: 0,
  sortNo: 0,
  bgColor: '#FFFFFF',
  memo: ''
})
const formError = ref('')
const submitting = ref(false)

const formatTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const loadList = async (): Promise<void> => {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.listBatInfo()
    if (result.ok) {
      items.value = result.items ?? []
    } else {
      error.value = result.message ?? '加载失败'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    loading.value = false
  }
}

const loadArcTypes = async (): Promise<void> => {
  try {
    // 仅取有效（statusFlag = 1）的档案类型
    const result = await window.api.listArcType({ includeDisabled: false })
    if (result.ok) {
      arcTypeOptions.value = (result.items ?? []).map((t) => ({
        typeId: t.typeId,
        arcTypeCode: t.arcTypeCode,
        arcTypeName: t.arcTypeName
      }))
    }
  } catch {
    // 下拉加载失败不阻塞列表，提交时后端仍会校验
  }
}

const loadDefaultBgColor = async (): Promise<void> => {
  try {
    const settings = await window.api.getSettings()
    defaultBgColor.value = settings.defaultBgColor || '#FFFFFF'
  } catch {
    // 读取失败时使用白色兜底，不影响页面使用
  }
}

onMounted(async () => {
  await Promise.all([loadList(), loadArcTypes(), loadDefaultBgColor()])
})

const openCreate = (): void => {
  editing.value = null
  form.arcTypeId = arcTypeOptions.value[0]?.typeId ?? ''
  form.status = 0
  form.sortNo = items.value.length ? Math.max(...items.value.map((i) => i.sortNo)) + 1 : 1
  form.bgColor = defaultBgColor.value
  form.memo = ''
  formError.value = ''
  modalVisible.value = true
}

const openEdit = (row: BatInfoRow): void => {
  editing.value = row
  form.arcTypeId = row.arcTypeId
  form.status = row.status
  form.sortNo = row.sortNo
  form.bgColor = row.bgColor || '#FFFFFF'
  form.memo = row.memo
  formError.value = ''
  modalVisible.value = true
}

const submitForm = async (): Promise<void> => {
  if (!form.arcTypeId) {
    formError.value = '请选择档案类型'
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    const payload = {
      arcTypeId: form.arcTypeId,
      status: form.status,
      sortNo: form.sortNo,
      bgColor: form.bgColor,
      memo: form.memo.trim()
    }
    const result = editing.value
      ? await window.api.updateBatInfo({ batId: editing.value.batId, ...payload })
      : await window.api.createBatInfo(payload)

    if (!result.ok) {
      formError.value = result.message ?? (editing.value ? '保存失败' : '创建失败')
      return
    }
    modalVisible.value = false
    await loadList()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    submitting.value = false
  }
}

const removeItem = async (row: BatInfoRow): Promise<void> => {
  if (!confirm(`确定删除批次「${row.batCode}」？其字段快照将一并删除。`)) return
  try {
    const result = await window.api.deleteBatInfo({ batId: row.batId })
    if (!result.ok) {
      alert(result.message ?? '删除失败')
      return
    }
    await loadList()
  } catch (e) {
    alert(e instanceof Error ? e.message : '未知错误')
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">批次管理</h2>
        <p class="page-description">按档案类型建立批次，批次字段在创建时快照固定。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" type="button" @click="openCreate">新增批次</button>
      </div>
    </div>

    <section class="card">
      <div v-if="loading" class="loading-state">加载中…</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>批次编号</th>
              <th>档案类型</th>
              <th>建立时间</th>
              <th>状态</th>
              <th>排序号</th>
              <th>底色</th>
              <th>备注</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.batId">
              <td>
                <code class="code-tag">{{ row.batCode }}</code>
              </td>
              <td>
                <strong>{{ row.arcTypeName }}</strong>
              </td>
              <td class="time-cell">{{ formatTime(row.timeOfCreate) }}</td>
              <td>
                <span class="tag" :class="row.status === 1 ? 'tag-success' : 'tag-neutral'">
                  {{ row.status === 1 ? '已完成' : '进行中' }}
                </span>
              </td>
              <td class="mono-cell">{{ row.sortNo }}</td>
              <td class="color-cell">
                <span
                  class="color-swatch"
                  :style="{ backgroundColor: row.bgColor || '#FFFFFF' }"
                ></span>
                <code class="color-code">{{ row.bgColor || '#FFFFFF' }}</code>
              </td>
              <td class="memo-cell">{{ row.memo || '—' }}</td>
              <td class="col-actions">
                <button
                  class="icon-btn-inline primary"
                  type="button"
                  title="进入批次"
                  @click="router.push(`/batches/${row.batId}/fields`)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
                <button class="icon-btn-inline" type="button" title="编辑" @click="openEdit(row)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
                <button class="icon-btn-inline danger" type="button" title="删除" @click="removeItem(row)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
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
        <p v-if="!items.length" class="empty-state">暂无批次，点击右上角「新增批次」开始。</p>
      </div>
    </section>

    <div v-if="modalVisible" class="modal-mask" @click.self="modalVisible = false">
      <div class="modal">
        <div class="card-header">
          <h3 class="card-title">{{ editing ? '编辑批次' : '新增批次' }}</h3>
          <button class="close-btn" type="button" @click="modalVisible = false">×</button>
        </div>
        <div class="card-body">
          <div class="form-item">
            <label class="form-label">批次编号</label>
            <input
              class="input"
              type="text"
              :value="editing ? editing.batCode : '保存后自动生成'"
              disabled
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="bat-type">档案类型</label>
            <select id="bat-type" v-model="form.arcTypeId" class="input">
              <option value="" disabled>请选择</option>
              <option v-for="t in arcTypeOptions" :key="t.typeId" :value="t.typeId">
                {{ t.arcTypeName }}（{{ t.arcTypeCode }}）
              </option>
            </select>
            <p v-if="!arcTypeOptions.length" class="form-hint">
              暂无有效档案类型，请先在「设置 → 档案类型」中创建并定义字段。
            </p>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="bat-status">状态</label>
            <select id="bat-status" v-model.number="form.status" class="input">
              <option :value="0">进行中</option>
              <option :value="1">已完成</option>
            </select>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="bat-sort">排序号</label>
            <input id="bat-sort" v-model.number="form.sortNo" class="input" type="number" min="0" />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="bat-bg-color">底色</label>
            <div class="color-field">
              <input id="bat-bg-color" v-model="form.bgColor" class="color-input" type="color" />
              <span class="color-value">{{ form.bgColor }}</span>
            </div>
            <p v-if="!editing" class="form-hint">默认取系统设置中的默认底色。</p>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="bat-memo">备注</label>
            <textarea
              id="bat-memo"
              v-model="form.memo"
              class="input"
              rows="3"
              placeholder="可选：批次相关的补充信息"
            ></textarea>
          </div>
          <p v-if="editing" class="form-hint modal-gap">
            修改档案类型将删除原字段快照并按新类型重新快照。
          </p>
          <p v-if="formError" class="form-error">{{ formError }}</p>
        </div>
        <div class="modal-footer">
          <button class="icon-btn-lg" type="button" title="取消" @click="modalVisible = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            <span>取消</span>
          </button>
          <button
            class="icon-btn-lg primary"
            type="button"
            title="保存"
            :disabled="submitting"
            @click="submitForm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>{{ submitting ? '保存中…' : editing ? '保存' : '创建' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-tag {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-soft);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-primary);
}

.time-cell {
  font-size: 12px;
  color: var(--color-text-2);
  white-space: nowrap;
}

.mono-cell {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  text-align: center;
  color: var(--color-text-2);
}

.memo-cell {
  max-width: 220px;
  color: var(--color-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.color-cell {
  white-space: nowrap;
}

.color-swatch {
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  vertical-align: -3px;
}

.color-code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-text-2);
}

.color-field {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
}

.color-input {
  width: 48px;
  height: 34px;
  padding: 2px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  cursor: pointer;
}

.color-value {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-text-2);
}

textarea.input {
  min-height: 68px;
  resize: vertical;
}

.form-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-text-3);
}

.loading-state {
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-3);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border);
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
  transition: background-color 0.15s ease, color 0.15s ease;
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

.icon-btn-lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface);
  font-size: 13px;
  color: var(--color-text-2);
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.icon-btn-lg:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.icon-btn-lg.primary {
  border-color: transparent;
  background-color: var(--color-primary);
  color: #fff;
}

.icon-btn-lg.primary:hover {
  background-color: color-mix(in srgb, var(--color-primary) 88%, black);
  color: #fff;
}

.icon-btn-lg:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.icon-btn-lg svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
