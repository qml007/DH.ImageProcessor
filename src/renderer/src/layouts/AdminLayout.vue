<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

interface MenuItem {
  path: string
  label: string
  icon: string[]
  badge?: string
}

interface MenuGroup {
  title: string
  items: MenuItem[]
}

const route = useRoute()
const router = useRouter()

const keyword = ref('')

const menuGroups: MenuGroup[] = [
  {
    title: '概览',
    items: [
      {
        path: '/dashboard',
        label: '工作台',
        icon: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z']
      }
    ]
  },
  {
    title: '业务管理',
    items: [
      {
        path: '/users',
        label: '用户管理',
        badge: '6',
        icon: [
          'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
          'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
          'M22 21v-2a4 4 0 0 0-3-3.87',
          'M16 3.13a4 4 0 0 1 0 7.75'
        ]
      },
      {
        path: '/images',
        label: '图像处理',
        icon: ['M3 5h18v14H3z', 'M3 15.5l4.5-4.5 4 4 3-3 6.5 6.5', 'M15.5 9.5h.01']
      },
      {
        path: '/batches',
        label: '批次',
        icon: [
          'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
          'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
          'M9 7h7',
          'M9 11h7'
        ]
      }
    ]
  },
  {
    title: '设置',
    items: [
      {
        path: '/archives-types',
        label: '档案类型',
        icon: [
          'M3 7h18',
          'M3 12h18',
          'M3 17h10',
          'M14 4h7v7h-7z',
          'M16.5 7.5l1.5 1.5 2-2'
        ]
      },
      {
        path: '/ai-services',
        label: 'AI服务',
        icon: [
          'M12 3l1.8 4.9L18.7 9.7 13.8 11.5 12 16.4 10.2 11.5 5.3 9.7 10.2 7.9z',
          'M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z',
          'M5 15l.7 1.8L7.5 17.5 5.7 18.2 5 20l-.7-1.8L2.5 17.5l1.8-.7z'
        ]
      }
    ]
  }
]

const bottomMenus: MenuItem[] = [
  {
    path: '/settings',
    label: '系统设置',
    icon: [
      'M4 7h6',
      'M14 7h6',
      'M4 17h2',
      'M10 17h10',
      'M12 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
      'M8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4'
    ]
  }
]

const currentTitle = computed(() => (route.meta.title as string) ?? '工作台')

const isActive = (path: string): boolean => route.path === path || route.path.startsWith(`${path}/`)

const handleSearch = (): void => {
  router.push({ path: '/users', query: { keyword: keyword.value } })
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-logo" src="../assets/dh.png" alt="logo" />
        <div class="brand-text">
          <strong>DH.ImageProcessor</strong>
          <span>德鸿图像处理系统</span>
        </div>
      </div>

      <nav class="nav">
        <div v-for="group in menuGroups" :key="group.title" class="nav-group">
          <p class="nav-group-title">{{ group.title }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
          >
            <svg
              class="nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path v-for="d in item.icon" :key="d" :d="d" />
            </svg>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </RouterLink>
        </div>
      </nav>

      <div class="nav-bottom">
        <RouterLink
          v-for="item in bottomMenus"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
        >
          <svg
            class="nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path v-for="d in item.icon" :key="d" :d="d" />
          </svg>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </div>

      <div class="sidebar-footer">
        <span class="status-dot"></span>
        <span>系统运行正常</span>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="topbar-left">
          <h1 class="topbar-title">{{ currentTitle }}</h1>
          <p class="breadcrumb">
            <span>首页</span>
            <span class="separator">/</span>
            <span class="current">{{ currentTitle }}</span>
          </p>
        </div>

        <div class="topbar-right">
          <label class="search-box">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            >
              <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索用户、功能..."
              @keyup.enter="handleSearch"
            />
          </label>

          <button class="icon-btn" type="button" title="通知">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            >
              <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6z" />
              <path d="M10 19a2 2 0 0 0 4 0" />
            </svg>
            <span class="badge-dot"></span>
          </button>

          <div class="user-chip">
            <span class="avatar">管</span>
            <div class="user-info">
              <strong>管理员</strong>
              <span>admin@example.com</span>
            </div>
          </div>
        </div>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.sidebar {
  display: flex;
  flex-direction: column;
  width: 232px;
  flex-shrink: 0;
  background-color: var(--color-sidebar);
  color: var(--color-sidebar-text);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 60px;
  padding: 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.brand-logo {
  width: 30px;
  height: 30px;
  -webkit-user-drag: none;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.brand-text strong {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.brand-text span {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.nav {
  flex: 1;
  padding: 16px 10px;
  overflow-y: auto;
}

.nav-group + .nav-group {
  margin-top: 18px;
}

.nav-group-title {
  padding: 0 10px 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.32);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-sidebar-text);
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.nav-item:hover {
  background-color: var(--color-sidebar-hover);
  color: #fff;
}

.nav-item.active {
  background-color: var(--color-primary);
  color: var(--color-sidebar-active);
}

.nav-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.nav-label {
  flex: 1;
}

.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background-color: rgba(255, 255, 255, 0.14);
  font-size: 11px;
  color: #fff;
}

.nav-item.active .nav-badge {
  background-color: rgba(255, 255, 255, 0.24);
}

.nav-bottom {
  padding: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.16);
}

.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  height: 60px;
  flex-shrink: 0;
  padding: 0 24px;
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.topbar-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-3);
}

.breadcrumb .separator {
  color: var(--color-border-strong);
}

.breadcrumb .current {
  color: var(--color-text-2);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  width: 240px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 17px;
  background-color: var(--color-surface-soft);
  color: var(--color-text-3);
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease;
}

.search-box:focus-within {
  border-color: var(--color-primary);
  background-color: var(--color-surface);
}

.search-box svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.search-box input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 13px;
  outline: none;
}

.search-box input::placeholder {
  color: var(--color-text-3);
}

.icon-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  color: var(--color-text-2);
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.icon-btn:hover {
  background-color: var(--color-surface-soft);
  color: var(--color-primary);
}

.icon-btn svg {
  width: 19px;
  height: 19px;
}

.badge-dot {
  position: absolute;
  top: 6px;
  right: 7px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-danger);
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 14px;
  border-left: 1px solid var(--color-border);
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.user-info {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.user-info strong {
  font-size: 13px;
  font-weight: 600;
}

.user-info span {
  font-size: 11px;
  color: var(--color-text-3);
}

.content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

@media (max-width: 1080px) {
  .search-box {
    width: 180px;
  }
}

@media (max-width: 900px) {
  .sidebar {
    width: 68px;
  }

  .brand {
    justify-content: center;
    padding: 0;
  }

  .brand-text,
  .nav-group-title,
  .nav-label,
  .nav-badge,
  .sidebar-footer span:last-child,
  .user-info {
    display: none;
  }

  .nav-item {
    justify-content: center;
    padding: 0;
  }

  .sidebar-footer {
    justify-content: center;
  }

  .search-box {
    display: none;
  }
}
</style>