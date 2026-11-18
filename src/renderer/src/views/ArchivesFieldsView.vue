<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

interface ArcFieldInfoRow {
  fieldId: string
  arcTypeId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo: string
}

interface ArcTypeBrief {
  typeId: string
  arcTypeCode: string
  arcTypeName: string
}

const FIELD_TYPE_OPTIONS = ['字符串', '整数', '小数', '日期', '布尔', '文本']

const route = useRoute()
const router = useRouter()
const typeId = String(route.params.typeId ?? '')

const arcType = ref<ArcTypeBrief | null>(null)
const items = ref<ArcFieldInfoRow[]>([])
const loading = ref(false)
const error = ref('')

const modalVisible = ref(false)
const editing = ref<ArcFieldInfoRow | null>(null)
const form = reactive({
  sortNo: 1 as number,
  fieldName: '',
  fieldType: FIELD_TYPE_OPTIONS[0],
  isRequired: 0 as 0 | 1,
  memo: ''
})
const formError = ref('')

const loadArcType = async (): Promise<void> => {
  try {
    const result = await window.api.getArcType({ typeId })
    if (result.ok && result.item) {
      arcType.value = {
        typeId: result.item.typeId,
        arcTypeCode: result.item.arcTypeCode,
        arcTypeName: result.item.arcTypeName
      }
    } else {
      error.value = result.message ?? '档案类型不存在'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '未知错误'
  }
}

const loadList = async (): Promise<void> => {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.listArcFieldInfo({ arcTypeId: typeId })
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

onMounted(async () => {
  if (!typeId) {
    error.value = '缺少档案类型参数'
    return
  }
  await loadArcType()
  await loadList()
})

const nextSortNo = (): number => {
  if (!items.value.length) return 1
  return Math.max(...items.value.map((i) => i.sortNo)) + 1
}

const openCreate = (): void => {
  editing.value = null
  form.sortNo = nextSortNo()
  form.fieldName = ''
  form.fieldType = FIELD_TYPE_OPTIONS[0]
  form.isRequired = 0
  form.memo = ''
  formError.value = ''
  modalVisible.value = true
}

const openEdit = (row: ArcFieldInfoRow): void => {
  editing.value = row
  form.sortNo = row.sortNo
  form.fieldName = row.fieldName
  form.fieldType = row.fieldType
  form.isRequired = row.isRequired as 0 | 1
  form.memo = row.memo
  formError.value = ''
  modalVisible.value = true
}

const submitForm = async (): Promise<void> => {
  const name = form.fieldName.trim()
  if (!name) {
    formError.value = '请填写字段名称'
    return
  }
  if (!form.fieldType) {
    formError.value = '请选择字段类型'
    return
  }

  const payload = {
    arcTypeId: typeId,
    sortNo: form.sortNo,
    fieldName: name,
    fieldType: form.fieldType,
    isRequired: form.isRequired,
    memo: form.memo.trim()
  }

  try {
    if (editing.value) {
      const result = await window.api.updateArcFieldInfo({
        fieldId: editing.value.fieldId,
        ...payload
      })
      if (!result.ok) {
        formError.value = result.message ?? '保存失败'
        return
      }
    } else {
      const result = await window.api.createArcFieldInfo(payload)
      if (!result.ok) {
        formError.value = result.message ?? '创建失败'
        return
      }
    }
    modalVisible.value = false
    await loadList()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '未知错误'
  }
}

const removeItem = async (row: ArcFieldInfoRow): Promise<void> => {
  if (!confirm(`确定删除字段「${row.fieldName}」？`)) return
  try {
    const result = await window.api.deleteArcFieldInfo({ fieldId: row.fieldId })
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
        <h2 class="page-title">
          档案字段定义
          <template v-if="arcType">
            <span class="breadcrumb-sep">/</span>
            <code class="code-tag">{{ arcType.arcTypeCode }}</code>
            <span class="breadcrumb-sep">·</span>
            {{ arcType.arcTypeName }}
          </template>
        </h2>
        <p class="page-description">定义该档案类型包含的字段结构。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="router.push('/archives-types')">返回列表</button>
        <button class="btn btn-primary" type="button" @click="openCreate">新增字段</button>
      </div>
    </div>

    <section class="card">
      <div v-if="loading" class="loading-state">加载中…</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 80px">顺序号</th>
              <th>字段名称</th>
              <th style="width: 120px">字段类型</th>
              <th style="width: 100px">是否必须</th>
              <th>备注</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.fieldId">
              <td class="mono-cell">{{ row.sortNo }}</td>
              <td>
                <strong>{{ row.fieldName }}</strong>
              </td>
              <td>
                <span class="tag tag-neutral">{{ row.fieldType }}</span>
              </td>
              <td>
                <span
                  class="tag"
                  :class="row.isRequired === 1 ? 'tag-danger' : 'tag-neutral'"
                >
                  {{ row.isRequired === 1 ? '必须' : '可选' }}
                </span>
              </td>
              <td class="memo-cell">{{ row.memo || '—' }}</td>
              <td class="col-actions">
                <button
                  class="icon-btn-inline"
                  type="button"
                  title="编辑"
                  @click="openEdit(row)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
                <button
                  class="icon-btn-inline danger"
                  type="button"
                  title="删除"
                  @click="removeItem(row)"
                >
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
        <p v-if="!items.length" class="empty-state">
          暂无字段定义，点击右上角「新增字段」开始。
        </p>
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
            <label class="form-label" for="f-sort">顺序号</label>
            <input
              id="f-sort"
              v-model.number="form.sortNo"
              class="input"
              type="number"
              min="1"
              placeholder="1"
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="f-name">字段名称</label>
            <input
              id="f-name"
              v-model="form.fieldName"
              class="input"
              type="text"
              placeholder="如：发文编号"
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="f-type">字段类型</label>
            <select id="f-type" v-model="form.fieldType" class="input">
              <option
                v-for="t in FIELD_TYPE_OPTIONS"
                :key="t"
                :value="t"
              >
                {{ t }}
              </option>
            </select>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label">是否必须</label>
            <div class="form-control-row">
              <label class="switch">
                <input v-model="form.isRequired" type="checkbox" :true-value="1" :false-value="0" />
                <span class="switch-slider"></span>
              </label>
              <span class="switch-label">{{ form.isRequired === 1 ? '必须' : '可选' }}</span>
            </div>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="f-memo">备注</label>
            <textarea
              id="f-memo"
              v-model="form.memo"
              class="input"
              rows="3"
              placeholder="可选：字段用途说明"
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
          <button class="icon-btn-lg primary" type="button" title="保存" @click="submitForm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>{{ editing ? '保存' : '创建' }}</span>
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
  margin: 0 4px;
  color: var(--color-text-3);
  font-weight: 400;
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

.form-control-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  inset: 0;
  background-color: var(--color-border-strong);
  border-radius: 22px;
  cursor: pointer;
  transition: background-color 0.18s ease;
}

.switch-slider::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: #fff;
  transition: transform 0.18s ease;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
}

.switch input:checked + .switch-slider {
  background-color: var(--color-primary);
}

.switch input:checked + .switch-slider::before {
  transform: translateX(16px);
}

.switch-label {
  font-size: 13px;
  color: var(--color-text-2);
}

.loading-state {
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-3);
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

.modal {
  width: 440px;
  max-width: calc(100% - 40px);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.35);
}

.modal .card-body {
  padding: 20px;
}

.modal-gap {
  margin-top: 16px;
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

.form-error {
  margin-top: 12px;
  font-size: 12px;
  color: var(--color-danger);
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

/* 行内图标按钮（表格操作列） */
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

.icon-btn-inline.primary {
  color: var(--color-primary);
}

.icon-btn-inline.primary:hover {
  background-color: rgba(37, 99, 235, 0.08);
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

/* 底部图标 + 文字按钮（弹窗 footer） */
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

.icon-btn-lg svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
