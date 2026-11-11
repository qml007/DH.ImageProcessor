<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

interface BatInfoRow {
  batId: string
  batCode: string
  arcTypeId: string
  arcTypeName: string
  timeOfCreate: string
  status: number
  sortNo: number
  memo: string
}

interface BatFieldRow {
  id: string
  batId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo: string
}

const route = useRoute()
const router = useRouter()
const batId = String(route.params.batId ?? '')

const bat = ref<BatInfoRow | null>(null)
const items = ref<BatFieldRow[]>([])
const loading = ref(false)
const error = ref('')

const modalVisible = ref(false)
const editing = ref<BatFieldRow | null>(null)
const form = reactive({
  sortNo: 1,
  fieldName: '',
  fieldType: '字符串',
  isRequired: 0,
  memo: ''
})
const formError = ref('')
const submitting = ref(false)

const fieldTypeOptions = ['字符串', '整数', '小数', '日期', '布尔', '文本']

const formatTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const loadData = async (): Promise<void> => {
  loading.value = true
  error.value = ''
  try {
    const [batResult, listResult] = await Promise.all([
      window.api.getBatInfo({ batId }),
      window.api.listBatArcFieldInfo({ batId })
    ])
    if (!batResult.ok) {
      error.value = batResult.message ?? '加载批次失败'
      return
    }
    if (!batResult.item) {
      error.value = '批次不存在或已被删除'
      return
    }
    bat.value = batResult.item
    if (listResult.ok) {
      items.value = listResult.items ?? []
    } else {
      error.value = listResult.message ?? '加载字段失败'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

const goBack = (): void => {
  router.push('/batches')
}

const openCreate = (): void => {
  editing.value = null
  form.sortNo = items.value.length ? Math.max(...items.value.map((i) => i.sortNo)) + 1 : 1
  form.fieldName = ''
  form.fieldType = '字符串'
  form.isRequired = 0
  form.memo = ''
  formError.value = ''
  modalVisible.value = true
}

const openEdit = (row: BatFieldRow): void => {
  editing.value = row
  form.sortNo = row.sortNo
  form.fieldName = row.fieldName
  form.fieldType = row.fieldType
  form.isRequired = row.isRequired
  form.memo = row.memo
  formError.value = ''
  modalVisible.value = true
}

const submitForm = async (): Promise<void> => {
  if (!form.fieldName.trim()) {
    formError.value = '字段名称不能为空'
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    const payload = {
      batId,
      sortNo: form.sortNo,
      fieldName: form.fieldName.trim(),
      fieldType: form.fieldType,
      isRequired: form.isRequired,
      memo: form.memo.trim()
    }
    const result = editing.value
      ? await window.api.updateBatArcFieldInfo({ id: editing.value.id, ...payload })
      : await window.api.createBatArcFieldInfo(payload)

    if (!result.ok) {
      formError.value = result.message ?? (editing.value ? '保存失败' : '新增失败')
      return
    }
    modalVisible.value = false
    await loadData()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    submitting.value = false
  }
}

const removeItem = async (row: BatFieldRow): Promise<void> => {
  if (!confirm(`确定删除字段「${row.fieldName}」？`)) return
  try {
    const result = await window.api.deleteBatArcFieldInfo({ id: row.id })
    if (!result.ok) {
      alert(result.message ?? '删除失败')
      return
    }
    await loadData()
  } catch (e) {
    alert(e instanceof Error ? e.message : '未知错误')
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">
          批次字段
          <span v-if="bat" class="breadcrumb-sep">/</span>
          <code v-if="bat" class="code-tag">{{ bat.batCode }}</code>
          <span v-if="bat" class="type-name">{{ bat.arcTypeName }}</span>
        </h2>
        <p class="page-description">该批次创建时从档案类型快照的字段集合，可独立调整，不影响类型定义。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">← 返回批次列表</button>
        <button class="btn btn-primary" type="button" :disabled="!bat" @click="openCreate">
          新增字段
        </button>
      </div>
    </div>

    <section v-if="bat" class="card info-card">
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">批次编号</span>
          <code class="code-tag">{{ bat.batCode }}</code>
        </div>
        <div class="info-item">
          <span class="info-label">档案类型</span>
          <strong>{{ bat.arcTypeName }}</strong>
        </div>
        <div class="info-item">
          <span class="info-label">建立时间</span>
          <span>{{ formatTime(bat.timeOfCreate) }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">状态</span>
          <span class="tag" :class="bat.status === 1 ? 'tag-success' : 'tag-neutral'">
            {{ bat.status === 1 ? '已完成' : '进行中' }}
          </span>
        </div>
        <div v-if="bat.memo" class="info-item info-item-wide">
          <span class="info-label">备注</span>
          <span class="info-memo">{{ bat.memo }}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <div v-if="loading" class="loading-state">加载中…</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 70px">顺序号</th>
              <th>字段名称</th>
              <th style="width: 100px">字段类型</th>
              <th style="width: 90px">是否必须</th>
              <th>备注</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id">
              <td class="mono-cell">{{ row.sortNo }}</td>
              <td>
                <strong>{{ row.fieldName }}</strong>
              </td>
              <td>
                <span class="tag tag-neutral">{{ row.fieldType }}</span>
              </td>
              <td>
                <span class="tag" :class="row.isRequired === 1 ? 'tag-danger' : 'tag-neutral'">
                  {{ row.isRequired === 1 ? '必须' : '可选' }}
                </span>
              </td>
              <td class="memo-cell">{{ row.memo || '—' }}</td>
              <td class="col-actions">
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
        <p v-if="!items.length" class="empty-state">暂无字段，点击右上角「新增字段」。</p>
      </div>
    </section>

    <div v-if="modalVisible" class="modal-mask" @click.self="modalVisible = false">
      <div class="modal">
        <div class="card-header">
          <h3 class="card-title">{{ editing ? '编辑字段' : '新增字段' }}</h3>
          <button class="close-btn" type="button" @click="modalVisible = false">×</button>
        </div>
        <div class="card-body">
          <div class="form-item">
            <label class="form-label" for="field-sort">顺序号</label>
            <input id="field-sort" v-model.number="form.sortNo" class="input" type="number" min="1" />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="field-name">字段名称</label>
            <input
              id="field-name"
              v-model="form.fieldName"
              class="input"
              type="text"
              placeholder="如：档号、题名、年度"
              @keyup.enter="submitForm"
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="field-type">字段类型</label>
            <select id="field-type" v-model="form.fieldType" class="input">
              <option v-for="t in fieldTypeOptions" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label">是否必须</label>
            <div class="form-control-row">
              <button
                class="switch"
                :class="{ on: form.isRequired === 1 }"
                type="button"
                role="switch"
                :aria-checked="form.isRequired === 1"
                @click="form.isRequired = form.isRequired === 1 ? 0 : 1"
              >
                <span class="switch-thumb"></span>
              </button>
              <span class="switch-label">{{ form.isRequired === 1 ? '必须' : '可选' }}</span>
            </div>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="field-memo">备注</label>
            <textarea
              id="field-memo"
              v-model="form.memo"
              class="input"
              rows="3"
              placeholder="可选：字段的补充说明"
            ></textarea>
          </div>
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
            <span>{{ submitting ? '保存中…' : editing ? '保存' : '新增' }}</span>
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

.breadcrumb-sep {
  color: var(--color-text-3);
  margin: 0 4px;
}

.type-name {
  margin-left: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-2);
}

.info-card {
  margin-bottom: 14px;
}

.info-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 32px;
  padding: 14px 20px;
  align-items: center;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.info-item-wide {
  flex-basis: 100%;
}

.info-label {
  color: var(--color-text-3);
  font-size: 12px;
}

.info-memo {
  color: var(--color-text-2);
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

.loading-state {
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-3);
}

.form-control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
}

.switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background-color: var(--color-border-strong);
  transition: background-color 0.15s ease;
}

.switch.on {
  background-color: var(--color-primary);
}

.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: #fff;
  transition: left 0.15s ease;
}

.switch.on .switch-thumb {
  left: 20px;
}

.switch-label {
  font-size: 13px;
  color: var(--color-text-2);
}

textarea.input {
  min-height: 68px;
  resize: vertical;
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
