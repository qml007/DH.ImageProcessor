<script setup lang="ts">
import { computed, ref } from 'vue'

interface StatItem {
  label: string
  value: string
  delta: string
  trend: 'up' | 'down'
  color: string
  soft: string
  icon: string[]
}

const stats: StatItem[] = [
  {
    label: '总用户数',
    value: '8,846',
    delta: '+12.5%',
    trend: 'up',
    color: '#2563eb',
    soft: '#eef4ff',
    icon: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z']
  },
  {
    label: '今日访问量',
    value: '2,174',
    delta: '+6.8%',
    trend: 'up',
    color: '#16a34a',
    soft: '#e8f7ee',
    icon: ['M4 19V9', 'M10 19V5', 'M16 19v-7', 'M22 19V8']
  },
  {
    label: '待处理订单',
    value: '128',
    delta: '-3.2%',
    trend: 'down',
    color: '#d97706',
    soft: '#fff4e5',
    icon: ['M6 3h12l3 4v14H3V7z', 'M3 7h18', 'M9 12h6']
  },
  {
    label: '系统告警',
    value: '3',
    delta: '+1',
    trend: 'down',
    color: '#dc2626',
    soft: '#fdeceb',
    icon: ['M12 3 22 20H2z', 'M12 9v5', 'M12 17h.01']
  }
]

const trendData = [
  { label: '周一', value: 820 },
  { label: '周二', value: 1130 },
  { label: '周三', value: 960 },
  { label: '周四', value: 1480 },
  { label: '周五', value: 1720 },
  { label: '周六', value: 1240 },
  { label: '周日', value: 1590 }
]

const maxTrend = Math.max(...trendData.map((item) => item.value))

const activities = [
  {
    user: '张伟',
    initials: '张',
    action: '创建了新订单 #20260118',
    time: '2 分钟前',
    status: '成功',
    tag: 'tag-success'
  },
  {
    user: '李娜',
    initials: '李',
    action: '更新了用户权限配置',
    time: '18 分钟前',
    status: '已完成',
    tag: 'tag-primary'
  },
  {
    user: '王强',
    initials: '王',
    action: '提交了数据导出申请',
    time: '1 小时前',
    status: '待审核',
    tag: 'tag-warning'
  },
  {
    user: '赵敏',
    initials: '赵',
    action: '触发了接口调用频率告警',
    time: '3 小时前',
    status: '需关注',
    tag: 'tag-danger'
  }
]

const todos = ref([
  { id: 1, text: '审核 3 条新的数据导出申请', done: false },
  { id: 2, text: '处理待发货订单 128 笔', done: false },
  { id: 3, text: '检查接口告警日志', done: true },
  { id: 4, text: '更新月度运营报表', done: false }
])

const updatedAt = ref('')

const refresh = (): void => {
  updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

const completedCount = computed(() => todos.value.filter((item) => item.done).length)
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">工作台</h2>
        <p class="page-description">欢迎回来，这里是系统今日的整体运行概况。</p>
      </div>
      <div class="page-actions">
        <span v-if="updatedAt" class="updated-at">更新于 {{ updatedAt }}</span>
        <button class="btn" type="button" @click="refresh">刷新数据</button>
        <button class="btn btn-primary" type="button">导出报表</button>
      </div>
    </div>

    <div class="stat-grid">
      <div v-for="item in stats" :key="item.label" class="card stat-card">
        <div class="stat-head">
          <span class="stat-label">{{ item.label }}</span>
          <span class="stat-icon" :style="{ color: item.color, backgroundColor: item.soft }">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path v-for="d in item.icon" :key="d" :d="d" />
            </svg>
          </span>
        </div>
        <strong class="stat-value">{{ item.value }}</strong>
        <p class="stat-foot">
          <span class="stat-delta" :class="item.trend === 'up' ? 'up' : 'down'">
            {{ item.delta }}
          </span>
          <span>较上周</span>
        </p>
      </div>
    </div>

    <div class="content-grid">
      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">近 7 日访问趋势</h3>
            <p class="card-subtitle">单位：次</p>
          </div>
          <span class="tag tag-primary">周报</span>
        </div>
        <div class="card-body">
          <div class="chart">
            <div
              v-for="item in trendData"
              :key="item.label"
              class="chart-col"
              :title="`${item.label}：${item.value} 次`"
            >
              <div
                class="chart-bar"
                :style="{ height: `${Math.round((item.value / maxTrend) * 100)}%` }"
              ></div>
              <span class="chart-label">{{ item.label }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">待办事项</h3>
            <p class="card-subtitle">已完成 {{ completedCount }} / {{ todos.length }}</p>
          </div>
        </div>
        <ul class="todo-list">
          <li v-for="item in todos" :key="item.id" class="todo-item">
            <input v-model="item.done" class="todo-check" type="checkbox" />
            <span :class="{ done: item.done }">{{ item.text }}</span>
          </li>
        </ul>
      </section>
    </div>

    <section class="card">
      <div class="card-header">
        <h3 class="card-title">最新动态</h3>
        <button class="btn btn-sm" type="button">查看全部</button>
      </div>
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>操作人</th>
              <th>操作内容</th>
              <th>时间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in activities" :key="item.action">
              <td>
                <div class="user-cell">
                  <span class="cell-avatar">{{ item.initials }}</span>
                  <span>{{ item.user }}</span>
                </div>
              </td>
              <td>{{ item.action }}</td>
              <td>{{ item.time }}</td>
              <td>
                <span class="tag" :class="item.tag">{{ item.status }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.updated-at {
  font-size: 12px;
  color: var(--color-text-3);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.stat-card {
  padding: 18px 20px;
}

.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.stat-label {
  font-size: 13px;
  color: var(--color-text-2);
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
}

.stat-icon svg {
  width: 18px;
  height: 18px;
}

.stat-value {
  display: block;
  margin-top: 10px;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
}

.stat-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-3);
}

.stat-delta.up {
  color: var(--color-success);
}

.stat-delta.down {
  color: var(--color-danger);
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 16px;
  margin: 16px 0;
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  height: 216px;
}

.chart-col {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  flex: 1;
  height: 100%;
}

.chart-bar {
  width: 100%;
  max-width: 38px;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, #60a5fa, #2563eb);
  transition: opacity 0.18s ease;
}

.chart-col:hover .chart-bar {
  opacity: 0.82;
}

.chart-label {
  font-size: 12px;
  color: var(--color-text-3);
}

.todo-list {
  padding: 8px 0;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 20px;
  font-size: 13px;
  color: var(--color-text-2);
}

.todo-item + .todo-item {
  border-top: 1px solid var(--color-border);
}

.todo-check {
  width: 15px;
  height: 15px;
  accent-color: var(--color-primary);
}

.todo-item .done {
  color: var(--color-text-3);
  text-decoration: line-through;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-1);
}

.cell-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background-color: var(--color-primary-soft);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
}

@media (max-width: 1200px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}
</style>
