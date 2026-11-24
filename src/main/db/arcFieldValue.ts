import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'

export interface ArcFieldValueRow {
  valueId: string
  arcId: string
  batFieldId: string
  fieldName: string
  fieldValue: string
}

export interface ArcFieldValueInput {
  arcId: string
  batFieldId: string
  fieldName: string
  fieldValue: string
}

type RawRow = {
  valueId: string
  arcId: string
  batFieldId: string
  fieldName: string
  fieldValue: string | null
}

const mapRow = (row: RawRow): ArcFieldValueRow => ({
  valueId: row.valueId,
  arcId: row.arcId,
  batFieldId: row.batFieldId,
  fieldName: row.fieldName,
  fieldValue: row.fieldValue ?? ''
})

const SELECT_COLS = 'valueId, arcId, batFieldId, fieldName, fieldValue'

export function listArcFieldValue(arcId: string): ArcFieldValueRow[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcFieldValue WHERE arcId = ? ORDER BY fieldName`)
    .all(arcId) as RawRow[]

  return rows.map(mapRow)
}

export function getArcFieldValue(valueId: string): ArcFieldValueRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcFieldValue WHERE valueId = ?`)
    .get(valueId) as RawRow | undefined

  return row ? mapRow(row) : null
}

/** 按 档案 + 批次字段 写入或更新（同字段只保留一条） */
export function upsertArcFieldValue(input: ArcFieldValueInput): ArcFieldValueRow {
  const db = getDatabase()
  const existing = db
    .prepare(`SELECT ${SELECT_COLS} FROM arcFieldValue WHERE arcId = ? AND batFieldId = ?`)
    .get(input.arcId, input.batFieldId) as RawRow | undefined

  if (existing) {
    db.prepare('UPDATE arcFieldValue SET fieldName = ?, fieldValue = ? WHERE valueId = ?').run(
      input.fieldName,
      input.fieldValue,
      existing.valueId
    )
    return getArcFieldValue(existing.valueId)!
  }

  const valueId = generateSnowflakeId()
  db.prepare(
    `INSERT INTO arcFieldValue (valueId, arcId, batFieldId, fieldName, fieldValue)
     VALUES (?, ?, ?, ?, ?)`
  ).run(valueId, input.arcId, input.batFieldId, input.fieldName, input.fieldValue)

  return getArcFieldValue(valueId)!
}

export function deleteArcFieldValue(valueId: string): number {
  return getDatabase().prepare('DELETE FROM arcFieldValue WHERE valueId = ?').run(valueId).changes
}

export function deleteArcFieldValueByArc(arcId: string): number {
  return getDatabase().prepare('DELETE FROM arcFieldValue WHERE arcId = ?').run(arcId).changes
}

export interface ArcFieldValueSyncItem {
  batFieldId: string
  fieldName: string
  fieldValue: string
}

export interface ArcFieldValueSyncResult {
  inserted: number
  updated: number
  deleted: number
}

/**
 * 同步档案字段值：仅写入与数据库不一致的项。
 * - 未填写（空值）的字段不落库；若数据库原有值则删除该行。
 * - 值未变化时不产生任何写操作，减少数据库操作与日志。
 */
export function syncArcFieldValue(
  arcId: string,
  items: ArcFieldValueSyncItem[]
): ArcFieldValueSyncResult {
  const db = getDatabase()
  const existingRows = db
    .prepare(`SELECT ${SELECT_COLS} FROM arcFieldValue WHERE arcId = ?`)
    .all(arcId) as RawRow[]
  const existingMap = new Map(existingRows.map((row) => [row.batFieldId, row]))

  const insertStmt = db.prepare(
    `INSERT INTO arcFieldValue (valueId, arcId, batFieldId, fieldName, fieldValue)
     VALUES (?, ?, ?, ?, ?)`
  )
  const updateStmt = db.prepare(
    'UPDATE arcFieldValue SET fieldName = ?, fieldValue = ? WHERE valueId = ?'
  )
  const deleteStmt = db.prepare('DELETE FROM arcFieldValue WHERE valueId = ?')

  const result: ArcFieldValueSyncResult = { inserted: 0, updated: 0, deleted: 0 }

  const tx = db.transaction((): void => {
    for (const item of items) {
      const value = item.fieldValue ?? ''
      const existing = existingMap.get(item.batFieldId)

      // 未填写值：不保存空值，若原来有值则删除该行
      if (!value.trim()) {
        if (existing) {
          deleteStmt.run(existing.valueId)
          existingMap.delete(item.batFieldId)
          result.deleted += 1
        }
        continue
      }

      if (!existing) {
        insertStmt.run(generateSnowflakeId(), arcId, item.batFieldId, item.fieldName, value)
        result.inserted += 1
        continue
      }

      // 与数据库已有值相同则不写入
      if (existing.fieldValue === value && existing.fieldName === item.fieldName) {
        continue
      }

      updateStmt.run(item.fieldName, value, existing.valueId)
      result.updated += 1
    }
  })

  tx()

  return result
}
