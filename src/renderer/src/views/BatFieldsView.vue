<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { imageStore } from '../stores/imageStore'

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
  defaultValue: string
  memo: string
}

interface ArcInfoItem {
  arcId: string
  batId: string
  arcName: string
  sortNo: number
  status: number
  timeOfCreate: string
  memo: string
}

const route = useRoute()
const router = useRouter()
const batId = String(route.params.batId ?? '')

const bat = ref<BatInfoRow | null>(null)
const items = ref<BatFieldRow[]>([])
const loading = ref(false)
const error = ref('')

// 已完成的批次只读：不能新增、编辑或删除字段
const isCompleted = computed(() => bat.value?.status === 1)

const archiveItems = ref<ArcInfoItem[]>([])
const archiveImageCounts = ref<Record<string, number>>({})
const archivesLoading = ref(false)

// 字段 / 档案列表分页：默认每页 10 条，可自行调整
const pageSizeOptions = [10, 20, 50, 100]

const fieldPage = ref(1)
const fieldPageSize = ref(10)
const fieldTotalPages = computed(() =>
  Math.max(1, Math.ceil(items.value.length / fieldPageSize.value))
)
const currentFieldPage = computed(() => Math.min(fieldPage.value, fieldTotalPages.value))
const pagedFields = computed(() => {
  const start = (currentFieldPage.value - 1) * fieldPageSize.value
  return items.value.slice(start, start + fieldPageSize.value)
})

const archivePage = ref(1)
const archivePageSize = ref(10)
const archiveTotalPages = computed(() =>
  Math.max(1, Math.ceil(archiveItems.value.length / archivePageSize.value))
)
const currentArchivePage = computed(() => Math.min(archivePage.value, archiveTotalPages.value))
const pagedArchives = computed(() => {
  const start = (currentArchivePage.value - 1) * archivePageSize.value
  return archiveItems.value.slice(start, start + archivePageSize.value)
})

watch(fieldPageSize, () => {
  fieldPage.value = 1
})

watch(archivePageSize, () => {
  archivePage.value = 1
})

const modalVisible = ref(false)
const editing = ref<BatFieldRow | null>(null)
const form = reactive({
  sortNo: 1,
  fieldName: '',
  fieldType: '字符串',
  isRequired: 0,
  defaultValue: '',
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

const loadArchives = async (): Promise<void> => {
  archivesLoading.value = true
  try {
    const result = await window.api.listArcInfo({ batId })
    archiveItems.value = result.ok ? (result.items ?? []) : []

    const counts: Record<string, number> = {}
    await Promise.all(
      archiveItems.value.map(async (item) => {
        const images = await window.api.listArcImage({ arcId: item.arcId })
        counts[item.arcId] = images.ok ? (images.items?.length ?? 0) : 0
      })
    )
    archiveImageCounts.value = counts
  } catch (e) {
    console.error(e)
  } finally {
    archivesLoading.value = false
  }
}

const openArchive = async (arcId: string): Promise<void> => {
  await imageStore.setBatch(batId)
  imageStore.selectArchive(arcId)
  router.push('/images')
}

onMounted(() => {
  void loadData()
  void loadArchives()
})

const goBack = (): void => {
  router.push('/batches')
}

// 完成 / 继续处理：仅切换批次状态，其它信息保持不变
const updatingStatus = ref(false)

const changeBatchStatus = async (status: number): Promise<void> => {
  if (!bat.value || updatingStatus.value) return

  const confirmed =
    status === 1
      ? confirm(`确定将批次「${bat.value.batCode}」标记为已完成？`)
      : confirm(`确定将批次「${bat.value.batCode}」改回进行中，以便继续处理？`)
  if (!confirmed) return

  updatingStatus.value = true
  try {
    const result = await window.api.updateBatInfo({
      batId: bat.value.batId,
      arcTypeId: bat.value.arcTypeId,
      status
    })
    if (!result.ok) {
      alert(result.message ?? '更新批次状态失败')
      return
    }
    await loadData()
  } catch (e) {
    alert(e instanceof Error ? e.message : '未知错误')
  } finally {
    updatingStatus.value = false
  }
}

const openCreate = (): void => {
  editing.value = null
  form.sortNo = items.value.length ? Math.max(...items.value.map((i) => i.sortNo)) + 1 : 1
  form.fieldName = ''
  form.fieldType = '字符串'
  form.isRequired = 0
  form.defaultValue = ''
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
  form.defaultValue = row.defaultValue
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
      defaultValue: form.defaultValue.trim(),
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
          批次信息
          <span v-if="bat" class="breadcrumb-sep">/</span>
          <code v-if="bat" class="code-tag">{{ bat.batCode }}</code>
          <span v-if="bat" class="type-name">{{ bat.arcTypeName }}</span>
        </h2>
        <p class="page-description">
          该批次创建时从档案类型快照的字段集合，可独立调整，不影响类型定义。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">← 返回批次列表</button>
        <button
          v-if="!isCompleted"
          class="btn btn-primary"
          type="button"
          :disabled="!bat"
          @click="openCreate"
        >
          新增字段
        </button>
        <button
          v-if="bat && bat.status === 0"
          class="btn"
          type="button"
          :disabled="updatingStatus"
          @click="changeBatchStatus(1)"
        >
          完成
        </button>
        <button
          v-if="bat && bat.status === 1"
          class="btn"
          type="button"
          :disabled="updatingStatus"
          @click="changeBatchStatus(0)"
        >
          继续处理
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
      <template v-else>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 70px">顺序号</th>
                <th>字段名称</th>
                <th>字段类型</th>
                <th>默认值</th>
                <th>是否必须</th>
                <th>备注</th>
                <th v-if="!isCompleted" class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pagedFields" :key="row.id">
                <td class="mono-cell">{{ row.sortNo }}</td>
                <td>
                  <strong>{{ row.fieldName }}</strong>
                </td>
                <td>
                  <span class="tag tag-neutral">{{ row.fieldType }}</span>
                </td>
                <td class="memo-cell">{{ row.defaultValue || '—' }}</td>
                <td>
                  <span class="tag" :class="row.isRequired === 1 ? 'tag-danger' : 'tag-neutral'">
                    {{ row.isRequired === 1 ? '必须' : '可选' }}
                  </span>
                </td>
                <td class="memo-cell">{{ row.memo || '—' }}</td>
                <td v-if="!isCompleted" class="col-actions">
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
          <p v-if="!items.length" class="empty-state">暂无字段，点击右上角「新增字段」。</p>
        </div>

        <div v-if="items.length" class="pagination">
          <span>共 {{ items.length }} 条记录</span>
          <div class="pagination-right">
            <label class="page-size">
              每页
              <select v-model.number="fieldPageSize" class="input page-size-select">
                <option v-for="size in pageSizeOptions" :key="size" :value="size">
                  {{ size }}
                </option>
              </select>
              条
            </label>
            <div class="pagination-pages">
              <button
                type="button"
                :disabled="currentFieldPage === 1"
                @click="fieldPage = currentFieldPage - 1"
              >
                上一页
              </button>
              <button
                v-for="p in fieldTotalPages"
                :key="p"
                type="button"
                :class="{ active: p === currentFieldPage }"
                @click="fieldPage = p"
              >
                {{ p }}
              </button>
              <button
                type="button"
                :disabled="currentFieldPage === fieldTotalPages"
                @click="fieldPage = currentFieldPage + 1"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <section class="card archive-card">
      <div class="card-header">
        <h3 class="card-title">档案</h3>
        <span class="card-subtitle">{{ archiveItems.length }} 个</span>
      </div>

      <div v-if="archivesLoading" class="loading-state">加载中…</div>
      <template v-else>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>档案名称</th>
                <th>图像数量</th>
                <th>状态</th>
                <th>建立时间</th>
                <th>备注</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="arc in pagedArchives" :key="arc.arcId">
                <td>
                  <strong>{{ arc.arcName }}</strong>
                </td>
                <td class="mono-cell" style="text-align: left">
                  {{ archiveImageCounts[arc.arcId] ?? 0 }}
                </td>
                <td>
                  <span class="tag" :class="arc.status === 1 ? 'tag-success' : 'tag-neutral'">
                    {{ arc.status === 1 ? '已完成' : '进行中' }}
                  </span>
                </td>
                <td class="time-cell">{{ formatTime(arc.timeOfCreate) }}</td>
                <td class="memo-cell">{{ arc.memo || '—' }}</td>
                <td class="col-actions">
                  <button
                    class="icon-btn-inline primary"
                    type="button"
                    title="进入该档案的图像"
                    @click="openArchive(arc.arcId)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!archiveItems.length" class="empty-state">
            该批次暂无档案，可在「图像处理」页导入图像时创建。
          </p>
        </div>

        <div v-if="archiveItems.length" class="pagination">
          <span>共 {{ archiveItems.length }} 条记录</span>
          <div class="pagination-right">
            <label class="page-size">
              每页
              <select v-model.number="archivePageSize" class="input page-size-select">
                <option v-for="size in pageSizeOptions" :key="size" :value="size">
                  {{ size }}
                </option>
              </select>
              条
            </label>
            <div class="pagination-pages">
              <button
                type="button"
                :disabled="currentArchivePage === 1"
                @click="archivePage = currentArchivePage - 1"
              >
                上一页
              </button>
              <button
                v-for="p in archiveTotalPages"
                :key="p"
                type="button"
                :class="{ active: p === currentArchivePage }"
                @click="archivePage = p"
              >
                {{ p }}
              </button>
              <button
                type="button"
                :disabled="currentArchivePage === archiveTotalPages"
                @click="archivePage = currentArchivePage + 1"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </template>
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
            <input
              id="field-sort"
              v-model.number="form.sortNo"
              class="input"
              type="number"
              min="1"
            />
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
            <label class="form-label" for="field-default">默认值</label>
            <input
              id="field-default"
              v-model="form.defaultValue"
              class="input"
              type="text"
              placeholder="可选：该档案还没有字段值时自动填入"
            />
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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
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
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
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
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
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

.pagination-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-size {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-2);
}

.page-size-select {
  height: 30px;
  padding: 0 8px;
  cursor: pointer;
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

.archive-card {
  margin-top: 14px;
}

.time-cell {
  font-size: 12px;
  color: var(--color-text-2);
  white-space: nowrap;
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
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
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
