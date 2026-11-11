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
