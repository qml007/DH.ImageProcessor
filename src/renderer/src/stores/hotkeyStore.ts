import { reactive } from 'vue'
import {
  HOTKEY_CONFIG_KEY,
  HOTKEY_CONFIG_MEMO,
  cloneHotkeyConfig,
  emptyHotkeyConfig,
  parseHotkeyConfig,
  serializeHotkeyConfig,
  type HotkeyConfig
} from '../utils/hotkeys'

const state = reactive({
  config: emptyHotkeyConfig(),
  revision: 0,
  loaded: false,
  loading: false
})

let pendingLoad: Promise<HotkeyConfig> | null = null

const applyConfig = (config: HotkeyConfig, bumpRevision: boolean): void => {
  state.config = config
  state.loaded = true
  if (bumpRevision) state.revision += 1
}

const load = async (force = false): Promise<HotkeyConfig> => {
  if (state.loaded && !force) return state.config
  if (pendingLoad) return pendingLoad

  state.loading = true
  pendingLoad = (async () => {
    try {
      const result = await window.api.getConfig({ configKey: HOTKEY_CONFIG_KEY })
      const config = result.ok ? parseHotkeyConfig(result.item?.configValue) : emptyHotkeyConfig()
      applyConfig(config, false)
      return config
    } catch (error) {
      console.error('Failed to load hotkey settings:', error)
      applyConfig(emptyHotkeyConfig(), false)
      return state.config
    } finally {
      state.loading = false
      pendingLoad = null
    }
  })()

  return pendingLoad
}

const save = async (config: HotkeyConfig): Promise<{ ok: boolean; message?: string }> => {
  const payload = serializeHotkeyConfig(config)

  try {
    const result = await window.api.setConfig({
      configKey: HOTKEY_CONFIG_KEY,
      configValue: payload,
      memo: HOTKEY_CONFIG_MEMO
    })

    if (!result.ok) return { ok: false, message: result.message }

    applyConfig(parseHotkeyConfig(payload), true)
    return { ok: true }
  } catch (error) {
    console.error('Failed to save hotkey settings:', error)
    return { ok: false, message: error instanceof Error ? error.message : '保存快捷键失败' }
  }
}

const bindingsOf = (categoryKey: string): Record<string, string> =>
  state.config.categories[categoryKey] ?? {}

const cloneDraft = (): HotkeyConfig => cloneHotkeyConfig(state.config)

export const hotkeyStore = {
  state,
  load,
  save,
  bindingsOf,
  cloneDraft
}
