import { getDatabase } from './connection'

export interface SystemConfigRow {
  configKey: string
  configValue: string
  memo: string
}

export function listConfig(): SystemConfigRow[] {
  const rows = getDatabase()
    .prepare('SELECT configKey, configValue, memo FROM systemconfig ORDER BY configKey')
    .all() as Array<{ configKey: string; configValue: string | null; memo: string | null }>

  return rows.map((row) => ({
    configKey: row.configKey,
    configValue: row.configValue ?? '',
    memo: row.memo ?? ''
  }))
}

export function getConfig(configKey: string): SystemConfigRow | null {
  const row = getDatabase()
    .prepare('SELECT configKey, configValue, memo FROM systemconfig WHERE configKey = ?')
    .get(configKey) as
    | { configKey: string; configValue: string | null; memo: string | null }
    | undefined

  if (!row) return null

  return {
    configKey: row.configKey,
    configValue: row.configValue ?? '',
    memo: row.memo ?? ''
  }
}

export function setConfig(configKey: string, configValue: string, memo?: string): void {
  const db = getDatabase()

  if (memo === undefined) {
    // 不传 memo 时保留原 memo
    db.prepare(
      `INSERT INTO systemconfig (configKey, configValue, memo) VALUES (?, ?, '')
       ON CONFLICT(configKey) DO UPDATE SET configValue = excluded.configValue`
    ).run(configKey, configValue)
    return
  }

  db.prepare(
    `INSERT INTO systemconfig (configKey, configValue, memo) VALUES (?, ?, ?)
     ON CONFLICT(configKey) DO UPDATE SET
       configValue = excluded.configValue,
       memo = excluded.memo`
  ).run(configKey, configValue, memo)
}

export function deleteConfig(configKey: string): number {
  return getDatabase().prepare('DELETE FROM systemconfig WHERE configKey = ?').run(configKey)
    .changes
}
