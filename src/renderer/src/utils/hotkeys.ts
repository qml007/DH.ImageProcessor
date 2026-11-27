export const HOTKEY_CONFIG_KEY = 'hotkeySettings'

export const HOTKEY_CONFIG_MEMO = '自定义快捷键'

export const IMG_PROC_CATEGORY = 'imgProc'

export interface HotkeyAction {
  key: string
  label: string
  desc: string
}

export interface HotkeyCategory {
  key: string
  label: string
  actions: HotkeyAction[]
}

export const HOTKEY_CATEGORIES: HotkeyCategory[] = [
  {
    key: IMG_PROC_CATEGORY,
    label: '图像处理',
    actions: [
      {
        key: 'rotate-left',
        label: '左旋 90 度',
        desc: '逆时针旋转图片 90°'
      },
      {
        key: 'rotate-right',
        label: '右旋 90 度',
        desc: '顺时针旋转图片 90°'
      },
      {
        key: 'flip-horizontal',
        label: '水平翻转',
        desc: '左右对换图片（水平镜像）'
      },
      {
        key: 'flip-vertical',
        label: '垂直翻转',
        desc: '上下对换图片（垂直镜像）'
      },
      {
        key: 'auto-correct',
        label: '自动校正倾斜角',
        desc: '自动检测并摆正图片倾斜'
      },
      {
        key: 'manual-correct',
        label: '手动校正倾斜角',
        desc: '在图片上拖出一条直线，按该线倾斜角摆正图片'
      },
      {
        key: 'remove-color',
        label: '去色',
        desc: '吸取颜色，将相近像素置为底色'
      },
      {
        key: 'clean-border',
        label: '去黑边',
        desc: '去除图像四周的黑边，并以底色填充'
      },
      {
        key: 'discard',
        label: '去除',
        desc: '将所选区域清空为底色'
      },
      {
        key: 'keep',
        label: '保留',
        desc: '仅保留所选区域，其余清空为底色'
      },
      {
        key: 'keep-center',
        label: '保留并居中',
        desc: '仅保留所选区域，并移到图片正中央'
      },
      {
        key: 'grayscale',
        label: '灰度',
        desc: '将图片转换为黑白灰度效果'
      },
      {
        key: 'vintage',
        label: '复古',
        desc: '为图片添加复古胶片色调'
      },
      {
        key: 'sharpen',
        label: '锐化',
        desc: '加黑并锐化图片中的文字'
      },
      {
        key: 'page-number',
        label: '插入页码',
        desc: '在图片任意位置添加自定义页码'
      }
    ]
  }
]

export interface HotkeyConfig {
  version: number
  categories: Record<string, Record<string, string>>
}

const CONFIG_VERSION = 1

export const emptyHotkeyConfig = (): HotkeyConfig => {
  const categories: Record<string, Record<string, string>> = {}
  for (const category of HOTKEY_CATEGORIES) {
    categories[category.key] = {}
    for (const action of category.actions) {
      categories[category.key][action.key] = ''
    }
  }
  return { version: CONFIG_VERSION, categories }
}

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  ctrl: 'CommandOrControl',
  control: 'CommandOrControl',
  cmd: 'CommandOrControl',
  command: 'CommandOrControl',
  meta: 'CommandOrControl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift'
}

const MAIN_KEY_ALIASES: Record<string, string> = {
  esc: 'Esc',
  escape: 'Esc',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  space: 'Space',
  tab: 'Tab',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  numlock: 'Numlock',
  capslock: 'Capslock',
  scrolllock: 'Scrolllock'
}

const PRINTABLE_KEY = /^[a-z0-9!@#$%^&*()_\-={}[\]|\\:;"'<>,.?/~`]$/i

const MODIFIER_ORDER = ['CommandOrControl', 'Alt', 'Shift']

const canonicalMainKey = (token: string): string => {
  const lower = token.toLowerCase()

  const alias = MAIN_KEY_ALIASES[lower]
  if (alias) return alias

  if (/^f\d{1,2}$/.test(lower)) {
    const index = Number.parseInt(lower.slice(1), 10)
    return index >= 1 && index <= 24 ? `F${index}` : ''
  }

  if (token.length === 1 && PRINTABLE_KEY.test(token)) return token.toUpperCase()

  return ''
}

export const normalizeAccelerator = (value?: string | null): string => {
  if (!value) return ''

  const tokens = value
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)

  if (!tokens.length) return ''

  const modifiers = new Set<string>()
  let mainKey = ''

  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()]
    if (modifier) {
      modifiers.add(modifier)
      continue
    }

    const key = canonicalMainKey(token)
    if (!key || mainKey) return ''
    mainKey = key
  }

  if (!mainKey) return ''

  const parts: string[] = []
  for (const modifier of MODIFIER_ORDER) {
    if (modifiers.has(modifier)) parts.push(modifier)
  }
  parts.push(mainKey)

  return parts.join('+')
}

export const isSupportedAccelerator = (value?: string | null): boolean =>
  normalizeAccelerator(value) !== ''

export const parseHotkeyConfig = (raw?: string | null): HotkeyConfig => {
  const config = emptyHotkeyConfig()
  if (!raw) return config

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return config
  }

  if (!parsed || typeof parsed !== 'object') return config

  const source = (parsed as { categories?: unknown }).categories
  if (!source || typeof source !== 'object') return config

  for (const category of HOTKEY_CATEGORIES) {
    const categorySource = (source as Record<string, unknown>)[category.key]
    if (!categorySource || typeof categorySource !== 'object') continue

    for (const action of category.actions) {
      const value = (categorySource as Record<string, unknown>)[action.key]
      if (typeof value !== 'string') continue

      const accelerator = normalizeAccelerator(value)
      if (accelerator) config.categories[category.key][action.key] = accelerator
    }
  }

  return config
}

export const serializeHotkeyConfig = (config: HotkeyConfig): string => {
  const categories: Record<string, Record<string, string>> = {}

  for (const category of HOTKEY_CATEGORIES) {
    const bindings = config.categories[category.key] ?? {}
    const normalized: Record<string, string> = {}

    for (const action of category.actions) {
      const accelerator = normalizeAccelerator(bindings[action.key])
      if (accelerator) normalized[action.key] = accelerator
    }

    if (Object.keys(normalized).length) categories[category.key] = normalized
  }

  return JSON.stringify({ version: CONFIG_VERSION, categories })
}

export const cloneHotkeyConfig = (config: HotkeyConfig): HotkeyConfig =>
  parseHotkeyConfig(serializeHotkeyConfig(config))

export const RESERVED_ACCELERATORS = new Set(['Esc', 'Left', 'Right', 'Up', 'Down'])

export const isReservedAccelerator = (value?: string | null): boolean =>
  RESERVED_ACCELERATORS.has(normalizeAccelerator(value))

const EVENT_KEY_TO_ACCELERATOR: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Escape: 'Esc',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Space: 'Space',
  ' ': 'Space'
}

const resolveEventMainKey = (event: KeyboardEvent): string => {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)

  const mapped = EVENT_KEY_TO_ACCELERATOR[event.key]
  if (mapped) return mapped

  if (/^F\d{1,2}$/.test(event.key)) return event.key

  if (event.key.length === 1 && event.key !== '+' && PRINTABLE_KEY.test(event.key)) {
    return event.key.toUpperCase()
  }

  return ''
}

export const eventToAccelerator = (event: KeyboardEvent): string | null => {
  if (event.isComposing) return null
  if (event.getModifierState?.('AltGraph')) return null

  const mainKey = resolveEventMainKey(event)
  if (!mainKey) return null

  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(mainKey)

  return parts.join('+')
}

const HOTKEYS_JS_KEY: Record<string, string> = {
  Esc: 'esc',
  Left: 'left',
  Right: 'right',
  Up: 'up',
  Down: 'down',
  Enter: 'enter',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Space: 'space',
  Tab: 'tab',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Home: 'home',
  End: 'end'
}

const currentPlatform = (): string => window.electron?.process?.platform ?? 'win32'

export const acceleratorToHotkeysJs = (accelerator: string): string => {
  const normalized = normalizeAccelerator(accelerator)
  if (!normalized) return ''

  const isMac = currentPlatform() === 'darwin'

  return normalized
    .split('+')
    .map((token) => {
      if (token === 'CommandOrControl') return isMac ? 'meta' : 'ctrl'
      if (token === 'Alt') return 'alt'
      if (token === 'Shift') return 'shift'
      return HOTKEYS_JS_KEY[token] ?? token.toLowerCase()
    })
    .join('+')
}

const DISPLAY_KEY: Record<string, string> = {
  Esc: 'Esc',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Space: 'Space'
}

export const formatAccelerator = (accelerator?: string | null): string => {
  const normalized = normalizeAccelerator(accelerator)
  if (!normalized) return ''

  const isMac = currentPlatform() === 'darwin'

  return normalized
    .split('+')
    .map((token) => {
      if (token === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
      if (token === 'Alt') return isMac ? '⌥' : 'Alt'
      if (token === 'Shift') return isMac ? '⇧' : 'Shift'
      return DISPLAY_KEY[token] ?? token
    })
    .join(' + ')
}

export const actionLabelOf = (categoryKey: string, actionKey: string): string => {
  const category = HOTKEY_CATEGORIES.find((item) => item.key === categoryKey)
  return category?.actions.find((item) => item.key === actionKey)?.label ?? actionKey
}

export const rowIdOf = (categoryKey: string, actionKey: string): string =>
  `${categoryKey}:${actionKey}`

export interface HotkeyBindingEntry {
  rowId: string
  categoryKey: string
  actionKey: string
  accelerator: string
}

export const collectBindingEntries = (config: HotkeyConfig): HotkeyBindingEntry[] => {
  const entries: HotkeyBindingEntry[] = []

  for (const category of HOTKEY_CATEGORIES) {
    for (const action of category.actions) {
      const accelerator = normalizeAccelerator(config.categories[category.key]?.[action.key])
      if (!accelerator) continue
      entries.push({
        rowId: rowIdOf(category.key, action.key),
        categoryKey: category.key,
        actionKey: action.key,
        accelerator
      })
    }
  }

  return entries
}

export const findConflictRowIds = (config: HotkeyConfig): Set<string> => {
  const grouped = new Map<string, string[]>()

  for (const entry of collectBindingEntries(config)) {
    const rows = grouped.get(entry.accelerator) ?? []
    rows.push(entry.rowId)
    grouped.set(entry.accelerator, rows)
  }

  const conflicts = new Set<string>()
  for (const rows of grouped.values()) {
    if (rows.length > 1) rows.forEach((rowId) => conflicts.add(rowId))
  }

  return conflicts
}

export const validateHotkeyConfig = (config: HotkeyConfig): string => {
  const entries = collectBindingEntries(config)

  const grouped = new Map<string, HotkeyBindingEntry[]>()
  for (const entry of entries) {
    const rows = grouped.get(entry.accelerator) ?? []
    rows.push(entry)
    grouped.set(entry.accelerator, rows)
  }

  for (const [accelerator, rows] of grouped) {
    if (rows.length < 2) continue
    const labels = rows
      .map((row) => `「${actionLabelOf(row.categoryKey, row.actionKey)}」`)
      .join('、')
    return `${labels} 使用了相同的快捷键 ${formatAccelerator(accelerator)}，请修改后再保存`
  }

  for (const entry of entries) {
    if (!RESERVED_ACCELERATORS.has(entry.accelerator)) continue
    return `「${actionLabelOf(entry.categoryKey, entry.actionKey)}」使用了系统保留的快捷键 ${formatAccelerator(entry.accelerator)}，请更换`
  }

  return ''
}