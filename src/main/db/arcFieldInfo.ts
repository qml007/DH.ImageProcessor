import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'

export interface ArcFieldInfoRow {
  fieldId: string
  arcTypeId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo: string
}

export interface ArcFieldInfoInput {
  arcTypeId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo?: string
}

const mapArcFieldRow = (row: {
  fieldId: string
  arcTypeId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  memo: string | null
}): ArcFieldInfoRow => ({
  fieldId: row.fieldId,
  arcTypeId: row.arcTypeId,
  sortNo: row.sortNo,
  fieldName: row.fieldName,
  fieldType: row.fieldType,
  isRequired: row.isRequired,
  memo: row.memo ?? ''
})

const SELECT_COLS = 'fieldId, arcTypeId, sortNo, fieldName, fieldType, isRequired, memo'

export function listArcFieldInfo(arcTypeId: string): ArcFieldInfoRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${SELECT_COLS} FROM arcFieldInfo WHERE arcTypeId = ? ORDER BY sortNo, fieldName`
    )
    .all(arcTypeId) as Array<Parameters<typeof mapArcFieldRow>[0]>

  return rows.map(mapArcFieldRow)
}

export function getArcFieldInfo(fieldId: string): ArcFieldInfoRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcFieldInfo WHERE fieldId = ?`)
    .get(fieldId) as Parameters<typeof mapArcFieldRow>[0] | undefined

  return row ? mapArcFieldRow(row) : null
}

export function createArcFieldInfo(input: ArcFieldInfoInput): ArcFieldInfoRow {
  const db = getDatabase()
  const fieldId = generateSnowflakeId()
  db.prepare(
    `INSERT INTO arcFieldInfo (fieldId, arcTypeId, sortNo, fieldName, fieldType, isRequired, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fieldId,
    input.arcTypeId,
    input.sortNo,
    input.fieldName,
    input.fieldType,
    input.isRequired,
    input.memo ?? ''
  )
  return getArcFieldInfo(fieldId)!
}

export function updateArcFieldInfo(
  fieldId: string,
  input: ArcFieldInfoInput
): ArcFieldInfoRow | null {
  const db = getDatabase()
  const info = db
    .prepare(
      `UPDATE arcFieldInfo SET arcTypeId = ?, sortNo = ?, fieldName = ?, fieldType = ?, isRequired = ?, memo = ?
       WHERE fieldId = ?`
    )
    .run(
      input.arcTypeId,
      input.sortNo,
      input.fieldName,
      input.fieldType,
      input.isRequired,
      input.memo ?? '',
      fieldId
    )

  return info.changes > 0 ? getArcFieldInfo(fieldId) : null
}

export function deleteArcFieldInfo(fieldId: string): number {
  return getDatabase().prepare('DELETE FROM arcFieldInfo WHERE fieldId = ?').run(fieldId).changes
}
