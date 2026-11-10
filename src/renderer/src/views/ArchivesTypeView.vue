<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

interface ArcTypeRow {
  typeId: string
  arcTypeCode: string
  arcTypeName: string
  statusFlag: number
  memo: string
}

const router = useRouter()

const items = ref<ArcTypeRow[]>([])
const loading = ref(false)
const error = ref('')

const modalVisible = ref(false)
const editing = ref<ArcTypeRow | null>(null)
const form = reactive({
  arcTypeCode: '',
  arcTypeName: '',
  statusFlag: 1 as 0 | 1,
  memo: ''
})
const formError = ref('')

const loadList = async (): Promise<void> => {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.listArcType()
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

onMounted(loadList)

const openCreate = (): void => {
  editing.value = null
  form.arcTypeCode = ''
  form.arcTypeName = ''
  form.statusFlag = 1
  form.memo = ''
  formError.value = ''
  modalVisible.value = true
}

const openEdit = (row: ArcTypeRow): void => {
  editing.value = row
  form.arcTypeCode = row.arcTypeCode
  form.arcTypeName = row.arcTypeName
  form.statusFlag = row.statusFlag as 0 | 1
  form.memo = row.memo
  formError.value = ''
  modalVisible.value = true
}

const submitForm = async (): Promise<void> => {
  const code = form.arcTypeCode.trim()
  const name = form.arcTypeName.trim()

  if (!code) {
    formError.value = '请填写类型代码'
    return
  }
  if (!name) {
    formError.value = '请填写类型名称'
    return
  }

  const payload = {
    arcTypeCode: code,
    arcTypeName: name,
    statusFlag: form.statusFlag,
    memo: form.memo.trim()
  }

  try {
    if (editing.value) {
      const result = await window.api.updateArcType({
        typeId: editing.value.typeId,
        ...payload
      })
      if (!result.ok) {
        formError.value = result.message ?? '保存失败'
        return
      }
    } else {
      const result = await window.api.createArcType(payload)
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

const toggleEnabled = async (row: ArcTypeRow): Promise<void> => {
  const next = row.statusFlag === 1 ? 0 : 1
  try {
    const result = await window.api.updateArcType({
      typeId: row.typeId,
      arcTypeCode: row.arcTypeCode,
      arcTypeName: row.arcTypeName,
      statusFlag: next,
      memo: row.memo
    })
    if (!result.ok) {
      alert(result.message ?? '操作失败')
      return
    }
    await loadList()
  } catch (e) {
    alert(e instanceof Error ? e.message : '未知错误')
  }
}

const removeItem = async (row: ArcTypeRow): Promise<void> => {
  if (!confirm(`确定删除档案类型「${row.arcTypeName}」？其下的字段定义也会一并删除。`)) return
  try {
    const result = await window.api.deleteArcType({ typeId: row.typeId })
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
        <h2 class="page-title">档案类型</h2>
        <p class="page-description">定义档案的分类类型，及其包含的字段结构。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" type="button" @click="openCreate">新增档案类型</button>
      </div>
    </div>

    <section class="card">
      <div v-if="loading" class="loading-state">加载中…</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 140px">类型代码</th>
              <th>类型名称</th>
              <th style="width: 100px">是否有效</th>
              <th>备注</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.typeId">
              <td><code class="code-tag">{{ row.arcTypeCode }}</code></td>
              <td>
                <strong>{{ row.arcTypeName }}</strong>
              </td>
              <td>
                <span
                  class="tag"
                  :class="row.statusFlag === 1 ? 'tag-success' : 'tag-neutral'"
                >
                  {{ row.statusFlag === 1 ? '有效' : '已禁用' }}
                </span>
              </td>
              <td class="memo-cell">{{ row.memo || '—' }}</td>
              <td class="col-actions">
                <button
                  class="icon-btn-inline primary"
                  type="button"
                  title="进入字段定义"
                  @click="router.push({ path: `/archives-types/${row.typeId}/fields` })"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
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
                  class="icon-btn-inline"
                  :class="{ danger: row.statusFlag === 1, success: row.statusFlag === 0 }"
                  type="button"
                  :title="row.statusFlag === 1 ? '禁用' : '启用'"
                  @click="toggleEnabled(row)"
                >
                  <svg v-if="row.statusFlag === 1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M4.93 4.93l14.14 14.14" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <path d="m9 11 3 3L22 4" />
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
        <p v-if="!items.length" class="empty-state">暂无档案类型，点击右上角「新增档案类型」开始。</p>
      </div>
    </section>

    <div v-if="modalVisible" class="modal-mask" @click.self="modalVisible = false">
      <div class="modal">
        <div class="card-header">
          <h3 class="card-title">{{ editing ? '编辑档案类型' : '新增档案类型' }}</h3>
          <button class="close-btn" type="button" @click="modalVisible = false">×</button>
        </div>
        <div class="card-body">
          <div class="form-item">
            <label class="form-label" for="at-code">类型代码</label>
            <input
              id="at-code"
              v-model="form.arcTypeCode"
              class="input"
              type="text"
              placeholder="如：ARCHIVE_DAILY"
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="at-name">类型名称</label>
            <input
              id="at-name"
              v-model="form.arcTypeName"
              class="input"
              type="text"
              placeholder="如：日常文书档案"
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label">是否有效</label>
            <div class="form-control-row">
              <label class="switch">
                <input v-model="form.statusFlag" type="checkbox" :true-value="1" :false-value="0" />
                <span class="switch-slider"></span>
              </label>
              <span class="switch-label">{{ form.statusFlag === 1 ? '有效' : '已禁用' }}</span>
            </div>
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="at-memo">备注</label>
            <textarea
              id="at-memo"
              v-model="form.memo"
              class="input"
              rows="3"
              placeholder="可选：描述该类型档案的用途"
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

.icon-btn-inline.danger:hover {
  color: var(--color-danger);
  background-color: rgba(239, 68, 68, 0.08);
}

.icon-btn-inline.success:hover {
  color: #22c55e;
  background-color: rgba(34, 197, 94, 0.1);
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
