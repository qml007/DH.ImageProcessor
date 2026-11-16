<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import Versions from '../components/Versions.vue'

const settings = reactive({
  appName: 'Electron 后台管理系统',
  description: '基于 Electron + Vue 3 + TypeScript 构建的桌面端管理平台。'
})

const savedMessage = ref('')
const ipcMessage = ref('')

const tempDir = ref('')
const tempDirBusy = ref(false)
const tempDirMessage = ref('')

const machineCode = ref('')
const machineCodeMessage = ref('读取中...')

const loadMachineCode = async (): Promise<void> => {
  try {
    const result = await window.api.getMachineCode()
    if (result.ok && result.code) {
      machineCode.value = result.code
    } else {
      machineCodeMessage.value = result.message || '无法读取本机识别码'
    }
  } catch (error) {
    console.error(error)
    machineCodeMessage.value = '无法读取本机识别码'
  }
}

const flashTempDirMessage = (text: string): void => {
  tempDirMessage.value = text
  window.setTimeout(() => {
    tempDirMessage.value = ''
  }, 2500)
}

const loadTempDir = async (): Promise<void> => {
  try {
    const config = await window.api.getSettings()
    tempDir.value = config.tempDir
  } catch (error) {
    console.error(error)
    flashTempDirMessage('读取临时文件夹配置失败')
  }
}

const chooseTempDir = async (): Promise<void> => {
  if (tempDirBusy.value) return

  tempDirBusy.value = true
  try {
    const result = await window.api.selectTempDir()
    if (result.canceled) return

    tempDir.value = result.settings.tempDir
    flashTempDirMessage(
      `${result.message || '临时文件夹已更新'}；原有历史临时文件仍在原文件夹，切换后将不可恢复`
    )
  } catch (error) {
    console.error(error)
    flashTempDirMessage('设置临时文件夹失败')
  } finally {
    tempDirBusy.value = false
  }
}

const openTempDir = async (): Promise<void> => {
  try {
    const result = await window.api.openTempDir()
    if (!result.ok) flashTempDirMessage(result.message || '无法打开临时文件夹')
  } catch (error) {
    console.error(error)
    flashTempDirMessage('无法打开临时文件夹')
  }
}

onMounted(() => {
  void loadTempDir()
  void loadMachineCode()
})

const save = (): void => {
  savedMessage.value = '设置已保存'
  setTimeout(() => {
    savedMessage.value = ''
  }, 2000)
}

const testIpc = (): void => {
  window.electron.ipcRenderer.send('ping')
  ipcMessage.value = 'IPC 消息已发送，主进程已收到 ping'
  setTimeout(() => {
    ipcMessage.value = ''
  }, 2500)
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">系统设置</h2>
        <p class="page-description">配置系统基础信息与运行参数。</p>
      </div>
    </div>

    <div class="settings-grid">
      <section class="card">
        <div class="card-header">
          <h3 class="card-title">基础设置</h3>
          <span v-if="savedMessage" class="tag tag-success">{{ savedMessage }}</span>
        </div>
        <div class="card-body">
          <div class="form-grid">
            <div class="form-item">
              <label class="form-label" for="app-name">系统名称</label>
              <input id="app-name" v-model="settings.appName" class="input" type="text" />
            </div>
            <div class="form-item form-item-full">
              <label class="form-label" for="app-desc">系统描述</label>
              <textarea id="app-desc" v-model="settings.description" class="textarea"></textarea>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" @click="save">保存设置</button>
            <button class="btn" type="button">恢复默认</button>
          </div>
        </div>
      </section>

      <section class="card about-card">
        <div class="card-header">
          <h3 class="card-title">关于系统</h3>
          <span class="tag tag-primary">运行环境</span>
        </div>
        <div class="card-body">
          <Versions />
          <div class="machine-code">
            <span class="machine-code-label">本机识别码</span>
            <strong class="machine-code-value">{{ machineCode || machineCodeMessage }}</strong>
          </div>
          <div class="about-actions">
            <button class="btn btn-sm" type="button" @click="testIpc">测试 IPC 通道</button>
            <span v-if="ipcMessage" class="ipc-tip">{{ ipcMessage }}</span>
          </div>
        </div>
      </section>

      <section class="card temp-card">
        <div class="card-header">
          <h3 class="card-title">临时文件夹</h3>
          <span v-if="tempDirMessage" class="tag tag-success">{{ tempDirMessage }}</span>
        </div>
        <div class="card-body">
          <p class="form-hint">
            图片编辑（旋转、倾斜校正等）产生的中间结果会写入该目录，翻页后再次查看仍会显示处理后的图片。
          </p>
          <div class="temp-dir-row">
            <input
              class="input temp-dir-input"
              type="text"
              readonly
              placeholder="尚未设置临时文件夹"
              :value="tempDir"
              title="临时文件夹位置"
            />
            <button class="btn" type="button" :disabled="tempDirBusy" @click="openTempDir">
              打开文件夹
            </button>
            <button
              class="btn btn-primary"
              type="button"
              :disabled="tempDirBusy"
              @click="chooseTempDir"
            >
              {{ tempDirBusy ? '选择中...' : '选择文件夹' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.switch-list {
  margin-top: 20px;
  border-top: 1px solid var(--color-border);
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}

.switch-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
}

.switch {
  appearance: none;
  position: relative;
  width: 42px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 11px;
  background-color: var(--color-border-strong);
  transition: background-color 0.2s ease;
  cursor: pointer;
}

.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: #fff;
  transition: transform 0.2s ease;
}

.switch:checked {
  background-color: var(--color-primary);
}

.switch:checked::after {
  transform: translateX(20px);
}

.form-actions {
  margin-top: 20px;
}

.temp-card {
  grid-column: 1 / -1;
}

.temp-dir-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.temp-dir-input {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  color: var(--color-text-2);
  cursor: default;
}

.about-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.ipc-tip {
  font-size: 12px;
  color: var(--color-success);
}

.machine-code {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  font-size: 13px;
  color: var(--color-text-2);
}

.machine-code-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-1);
  letter-spacing: 0.5px;
  text-align: right;
  word-break: break-all;
  user-select: text;
}

@media (max-width: 1080px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
