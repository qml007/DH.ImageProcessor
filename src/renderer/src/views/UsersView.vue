<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

interface User {
  id: number
  name: string
  email: string
  role: string
  roleTag: string
  status: '正常' | '禁用' | '待激活'
  statusTag: string
  createdAt: string
}

const route = useRoute()

const roleOptions = ['全部角色', '管理员', '编辑', '访客']
const statusOptions = ['全部状态', '正常', '禁用', '待激活']

const keyword = ref('')
const roleFilter = ref('全部角色')
const statusFilter = ref('全部状态')
const page = ref(1)
const pageSize = 5

const users = ref<User[]>([
  {
    id: 1,
    name: '张伟',
    email: 'zhangwei@example.com',
    role: '管理员',
    roleTag: 'tag-primary',
    status: '正常',
    statusTag: 'tag-success',
    createdAt: '2026-09-12'
  },
  {
    id: 2,
    name: '李娜',
    email: 'lina@example.com',
    role: '编辑',
    roleTag: 'tag-neutral',
    status: '正常',
    statusTag: 'tag-success',
    createdAt: '2026-09-20'
  },
  {
    id: 3,
    name: '王强',
    email: 'wangqiang@example.com',
    role: '访客',
    roleTag: 'tag-neutral',
    status: '待激活',
    statusTag: 'tag-warning',
    createdAt: '2026-10-03'
  },
  {
    id: 4,
    name: '赵敏',
    email: 'zhaomin@example.com',
    role: '编辑',
    roleTag: 'tag-neutral',
    status: '禁用',
    statusTag: 'tag-danger',
    createdAt: '2026-10-08'
  },
  {
    id: 5,
    name: '陈晨',
    email: 'chenchen@example.com',
    role: '管理员',
    roleTag: 'tag-primary',
    status: '正常',
    statusTag: 'tag-success',
    createdAt: '2026-10-15'
  },
  {
    id: 6,
    name: '刘洋',
    email: 'liuyang@example.com',
    role: '访客',
    roleTag: 'tag-neutral',
    status: '正常',
    statusTag: 'tag-success',
    createdAt: '2026-10-27'
  }
])

const selectedIds = ref<number[]>([])

const filteredUsers = computed(() =>
  users.value.filter((user) => {
    const matchKeyword =
      !keyword.value ||
      user.name.includes(keyword.value) ||
      user.email.toLowerCase().includes(keyword.value.toLowerCase())
    const matchRole = roleFilter.value === '全部角色' || user.role === roleFilter.value
    const matchStatus = statusFilter.value === '全部状态' || user.status === statusFilter.value
    return matchKeyword && matchRole && matchStatus
  })
)

const totalPages = computed(() => Math.max(1, Math.ceil(filteredUsers.value.length / pageSize)))

const pagedUsers = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredUsers.value.slice(start, start + pageSize)
})

const allSelected = computed({
  get: () =>
    pagedUsers.value.length > 0 && pagedUsers.value.every((u) => selectedIds.value.includes(u.id)),
  set: (value: boolean) => {
    const ids = pagedUsers.value.map((u) => u.id)
    selectedIds.value = value
      ? [...new Set([...selectedIds.value, ...ids])]
      : selectedIds.value.filter((id) => !ids.includes(id))
  }
})

watch([keyword, roleFilter, statusFilter], () => {
  page.value = 1
})

watch(
  () => route.query.keyword,
  (value) => {
    keyword.value = typeof value === 'string' ? value : ''
  },
  { immediate: true }
)

const toggleStatus = (user: User): void => {
  const disabled = user.status === '禁用'
  user.status = disabled ? '正常' : '禁用'
  user.statusTag = disabled ? 'tag-success' : 'tag-danger'
}

const removeUser = (id: number): void => {
  users.value = users.value.filter((user) => user.id !== id)
  selectedIds.value = selectedIds.value.filter((item) => item !== id)
  page.value = Math.min(page.value, totalPages.value)
}

const removeSelected = (): void => {
  users.value = users.value.filter((user) => !selectedIds.value.includes(user.id))
  selectedIds.value = []
  page.value = Math.min(page.value, totalPages.value)
}

const modalVisible = ref(false)
const form = reactive({ name: '', email: '', role: '访客' })
const formError = ref('')

const openModal = (): void => {
  form.name = ''
  form.email = ''
  form.role = '访客'
  formError.value = ''
  modalVisible.value = true
}

const createUser = (): void => {
  if (!form.name.trim() || !form.email.trim()) {
    formError.value = '请填写姓名与邮箱'
    return
  }
  users.value = [
    {
      id: Math.max(...users.value.map((user) => user.id)) + 1,
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      roleTag: form.role === '管理员' ? 'tag-primary' : 'tag-neutral',
      status: '待激活',
      statusTag: 'tag-warning',
      createdAt: new Date().toISOString().slice(0, 10)
    },
    ...users.value
  ]
  modalVisible.value = false
  page.value = 1
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">用户管理</h2>
        <p class="page-description">维护系统账号、角色与访问权限。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button">导出</button>
        <button class="btn btn-primary" type="button" @click="openModal">新增用户</button>
      </div>
    </div>

    <section class="card">
      <div class="toolbar">
        <div class="toolbar-left">
          <input
            v-model="keyword"
            class="input search-input"
            type="text"
            placeholder="搜索姓名或邮箱"
          />
          <select v-model="roleFilter" class="select">
            <option v-for="option in roleOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
          <select v-model="statusFilter" class="select">
            <option v-for="option in statusOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </div>
        <div class="toolbar-right">
          <span v-if="selectedIds.length" class="selected-tip"
            >已选择 {{ selectedIds.length }} 项</span
          >
          <button
            v-if="selectedIds.length"
            class="btn btn-sm btn-danger"
            type="button"
            @click="removeSelected"
          >
            批量删除
          </button>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th class="col-check">
                <input v-model="allSelected" type="checkbox" />
              </th>
              <th>用户</th>
              <th>角色</th>
              <th>状态</th>
              <th>注册时间</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in pagedUsers" :key="user.id">
              <td class="col-check">
                <input v-model="selectedIds" type="checkbox" :value="user.id" />
              </td>
              <td>
                <div class="user-cell">
                  <span class="cell-avatar">{{ user.name.slice(0, 1) }}</span>
                  <div class="cell-info">
                    <strong>{{ user.name }}</strong>
                    <span>{{ user.email }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span class="tag" :class="user.roleTag">{{ user.role }}</span>
              </td>
              <td>
                <span class="tag" :class="user.statusTag">{{ user.status }}</span>
              </td>
              <td>{{ user.createdAt }}</td>
              <td class="col-actions">
                <button class="link-btn" type="button" @click="toggleStatus(user)">
                  {{ user.status === '禁用' ? '启用' : '禁用' }}
                </button>
                <button class="link-btn danger" type="button" @click="removeUser(user.id)">
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!filteredUsers.length" class="empty-state">没有匹配的用户，试试调整筛选条件。</p>
      </div>

      <div class="pagination">
        <span>共 {{ filteredUsers.length }} 条记录</span>
        <div class="pagination-pages">
          <button type="button" :disabled="page === 1" @click="page--">上一页</button>
          <button
            v-for="p in totalPages"
            :key="p"
            type="button"
            :class="{ active: p === page }"
            @click="page = p"
          >
            {{ p }}
          </button>
          <button type="button" :disabled="page === totalPages" @click="page++">下一页</button>
        </div>
      </div>
    </section>

    <div v-if="modalVisible" class="modal-mask" @click.self="modalVisible = false">
      <div class="modal">
        <div class="card-header">
          <h3 class="card-title">新增用户</h3>
          <button class="close-btn" type="button" @click="modalVisible = false">×</button>
        </div>
        <div class="card-body">
          <div class="form-item">
            <label class="form-label" for="user-name">姓名</label>
            <input
              id="user-name"
              v-model="form.name"
              class="input"
              type="text"
              placeholder="请输入姓名"
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="user-email">邮箱</label>
            <input
              id="user-email"
              v-model="form.email"
              class="input"
              type="email"
              placeholder="name@example.com"
            />
          </div>
          <div class="form-item modal-gap">
            <label class="form-label" for="user-role">角色</label>
            <select id="user-role" v-model="form.role" class="select">
              <option value="管理员">管理员</option>
              <option value="编辑">编辑</option>
              <option value="访客">访客</option>
            </select>
          </div>
          <p v-if="formError" class="form-error">{{ formError }}</p>
        </div>
        <div class="modal-footer">
          <button class="btn" type="button" @click="modalVisible = false">取消</button>
          <button class="btn btn-primary" type="button" @click="createUser">确认创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.search-input {
  width: 220px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.selected-tip {
  font-size: 12px;
  color: var(--color-text-3);
}

.col-check {
  width: 48px;
  padding-right: 0;
}

.col-check input {
  accent-color: var(--color-primary);
}

.col-actions {
  white-space: nowrap;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cell-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background-color: var(--color-primary-soft);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
}

.cell-info {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.cell-info strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.cell-info span {
  font-size: 12px;
  color: var(--color-text-3);
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
  width: 420px;
  max-width: calc(100% - 40px);
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

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border);
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

@media (max-width: 760px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    width: 100%;
  }
}
</style>
