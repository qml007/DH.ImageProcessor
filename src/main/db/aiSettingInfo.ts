import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'

/** 高级参数类型：文本 / 数字 / 布尔 */
export type AiAdvancedParamType = 'text' | 'number' | 'boolean'

export interface AiAdvancedParam {
  key: string
  type: AiAdvancedParamType
  value: string
}

export interface AiSettingInfoRow {
  aiId: string
  name: string
  protocol: string
  baseUrl: string
  apiKey: string
  model: string
  supportsVision: number
  isDefault: number
  advancedParams: AiAdvancedParam[]
  sortNo: number
  timeOfCreate: string
  timeOfUpdate: string
}

export interface AiSettingInfoCreateInput {
  name: string
  protocol: string
  baseUrl: string
  apiKey?: string
  model: string
  supportsVision: number
  advancedParams?: AiAdvancedParam[]
  sortNo?: number
}

/** 名称建立后不可修改（步骤按名称引用），更新入参不含 name */
export type AiSettingInfoUpdateInput = Omit<AiSettingInfoCreateInput, 'name'>

const SELECT_COLS =
  'aiId, name, protocol, baseUrl, apiKey, model, supportsVision, isDefault, advancedJson, sortNo, timeOfCreate, timeOfUpdate'

interface RawRow {
  aiId: string
  name: string
  protocol: string
  baseUrl: string
  apiKey: string
  model: string
  supportsVision: number
  isDefault: number
  advancedJson: string
  sortNo: number
  timeOfCreate: string
  timeOfUpdate: string
}

const parseAdvanced = (json: string): AiAdvancedParam[] => {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.reduce<AiAdvancedParam[]>((list, item) => {
      if (!item || typeof item !== 'object') return list
      const record = item as Record<string, unknown>
      const key = typeof record.key === 'string' ? record.key.trim() : ''
      if (!key) return list

      const type: AiAdvancedParamType =
        record.type === 'number' || record.type === 'boolean' ? record.type : 'text'
      list.push({
        key,
        type,
        value: typeof record.value === 'string' ? record.value : String(record.value ?? '')
      })
      return list
    }, [])
  } catch {
    return []
  }
}

const mapRow = (row: RawRow): AiSettingInfoRow => ({
  aiId: row.aiId,
  name: row.name,
  protocol: row.protocol,
  baseUrl: row.baseUrl,
  apiKey: row.apiKey,
  model: row.model,
  supportsVision: row.supportsVision,
  isDefault: row.isDefault,
  advancedParams: parseAdvanced(row.advancedJson),
  sortNo: row.sortNo,
  timeOfCreate: row.timeOfCreate,
  timeOfUpdate: row.timeOfUpdate
})

/** 密钥仅展示首尾片段，完整密钥不返回给渲染进程 */
export const maskApiKey = (apiKey: string): string => {
  const key = apiKey.trim()
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 3)}••••${key.slice(-4)}`
}

const nowIso = (): string => new Date().toISOString()

const assertNameAvailable = (name: string, excludeId?: string): void => {
  const row = getDatabase().prepare('SELECT aiId FROM AISettingInfo WHERE name = ?').get(name) as
    { aiId: string } | undefined

  if (row && row.aiId !== excludeId) {
    throw new Error(`名称「${name}」已存在，请换一个名称`)
  }
}

export function listAiSettingInfo(): AiSettingInfoRow[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM AISettingInfo ORDER BY isDefault DESC, sortNo, name`)
    .all() as RawRow[]

  return rows.map(mapRow)
}

export function getAiSettingInfo(aiId: string): AiSettingInfoRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM AISettingInfo WHERE aiId = ?`)
    .get(aiId) as RawRow | undefined

  return row ? mapRow(row) : null
}

export function createAiSettingInfo(input: AiSettingInfoCreateInput): AiSettingInfoRow {
  const db = getDatabase()
  const name = input.name.trim()

  if (!name) throw new Error('名称不能为空')
  assertNameAvailable(name)

  const count = (
    db.prepare('SELECT COUNT(*) AS total FROM AISettingInfo').get() as {
      total: number
    }
  ).total
  const maxSort = (
    db.prepare('SELECT COALESCE(MAX(sortNo), 0) AS maxSort FROM AISettingInfo').get() as {
      maxSort: number
    }
  ).maxSort

  const aiId = generateSnowflakeId()
  const time = nowIso()

  db.prepare(
    `INSERT INTO AISettingInfo
       (aiId, name, protocol, baseUrl, apiKey, model, supportsVision, isDefault, advancedJson, sortNo, timeOfCreate, timeOfUpdate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    aiId,
    name,
    input.protocol || 'openai',
    (input.baseUrl ?? '').trim(),
    (input.apiKey ?? '').trim(),
    (input.model ?? '').trim(),
    input.supportsVision === 1 ? 1 : 0,
    count === 0 ? 1 : 0,
    JSON.stringify(input.advancedParams ?? []),
    input.sortNo ?? maxSort + 1,
    time,
    time
  )

  return getAiSettingInfo(aiId)!
}

export function updateAiSettingInfo(
  aiId: string,
  input: AiSettingInfoUpdateInput
): AiSettingInfoRow | null {
  const current = getAiSettingInfo(aiId)
  if (!current) return null

  const db = getDatabase()
  // apiKey 传 undefined 表示沿用原密钥（编辑时留空不覆盖）
  const apiKey = input.apiKey === undefined ? current.apiKey : input.apiKey.trim()

  db.prepare(
    `UPDATE AISettingInfo SET
       protocol = ?, baseUrl = ?, apiKey = ?, model = ?, supportsVision = ?, advancedJson = ?, sortNo = ?, timeOfUpdate = ?
     WHERE aiId = ?`
  ).run(
    input.protocol || current.protocol,
    (input.baseUrl ?? '').trim(),
    apiKey,
    (input.model ?? '').trim(),
    input.supportsVision === 1 ? 1 : 0,
    JSON.stringify(input.advancedParams ?? []),
    input.sortNo ?? current.sortNo,
    nowIso(),
    aiId
  )

  return getAiSettingInfo(aiId)
}

export function deleteAiSettingInfo(aiId: string): number {
  const db = getDatabase()
  const current = getAiSettingInfo(aiId)
  if (!current) return 0

  const removed = db.prepare('DELETE FROM AISettingInfo WHERE aiId = ?').run(aiId).changes

  // 默认服务被删除后，自动把排序最靠前的一条设为默认
  if (removed > 0 && current.isDefault === 1) {
    db.prepare(
      `UPDATE AISettingInfo SET isDefault = 1
       WHERE aiId = (SELECT aiId FROM AISettingInfo ORDER BY sortNo, name LIMIT 1)`
    ).run()
  }

  return removed
}

export function setDefaultAiSettingInfo(aiId: string): AiSettingInfoRow | null {
  const db = getDatabase()
  const target = getAiSettingInfo(aiId)
  if (!target) return null

  const tx = db.transaction((): void => {
    db.prepare('UPDATE AISettingInfo SET isDefault = 0 WHERE isDefault = 1').run()
    db.prepare('UPDATE AISettingInfo SET isDefault = 1, timeOfUpdate = ? WHERE aiId = ?').run(
      nowIso(),
      aiId
    )
  })
  tx()

  return getAiSettingInfo(aiId)
}

/** 默认服务（供后续步骤执行时取用） */
export function getDefaultAiSettingInfo(): AiSettingInfoRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM AISettingInfo WHERE isDefault = 1 LIMIT 1`)
    .get() as RawRow | undefined

  return row ? mapRow(row) : null
}
