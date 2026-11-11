import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'

export interface ArcTypeRow {
  typeId: string
  arcTypeCode: string
  arcTypeName: string
  statusFlag: number
  memo: string
}

export interface ArcTypeInput {
  arcTypeCode: string
  arcTypeName: string
  statusFlag: number
  memo?: string
}

const mapArcTypeRow = (row: {
  typeId: string
  arcTypeCode: string
  arcTypeName: string
  statusFlag: number
  memo: string | null
}): ArcTypeRow => ({
  typeId: row.typeId,
  arcTypeCode: row.arcTypeCode,
  arcTypeName: row.arcTypeName,
  statusFlag: row.statusFlag,
  memo: row.memo ?? ''
})

export function listArcType(includeDisabled = true): ArcTypeRow[] {
  const db = getDatabase()
  const rows = includeDisabled
    ? db
        .prepare(
          'SELECT typeId, arcTypeCode, arcTypeName, statusFlag, memo FROM arcType ORDER BY statusFlag DESC, arcTypeCode'
        )
        .all()
    : db
        .prepare(
          'SELECT typeId, arcTypeCode, arcTypeName, statusFlag, memo FROM arcType WHERE statusFlag = 1 ORDER BY arcTypeCode'
        )
        .all()

  return (rows as Array<Parameters<typeof mapArcTypeRow>[0]>).map(mapArcTypeRow)
}

export function getArcType(typeId: string): ArcTypeRow | null {
  const row = getDatabase()
    .prepare(
      'SELECT typeId, arcTypeCode, arcTypeName, statusFlag, memo FROM arcType WHERE typeId = ?'
    )
    .get(typeId) as Parameters<typeof mapArcTypeRow>[0] | undefined

  return row ? mapArcTypeRow(row) : null
}

export function createArcType(input: ArcTypeInput): ArcTypeRow {
  const db = getDatabase()
  const typeId = generateSnowflakeId()
  db.prepare(
    `INSERT INTO arcType (typeId, arcTypeCode, arcTypeName, statusFlag, memo)
     VALUES (?, ?, ?, ?, ?)`
  ).run(typeId, input.arcTypeCode, input.arcTypeName, input.statusFlag, input.memo ?? '')
  return getArcType(typeId)!
}

export function updateArcType(typeId: string, input: ArcTypeInput): ArcTypeRow | null {
  const db = getDatabase()
  const info = db
    .prepare(
      `UPDATE arcType SET arcTypeCode = ?, arcTypeName = ?, statusFlag = ?, memo = ?
       WHERE typeId = ?`
    )
    .run(input.arcTypeCode, input.arcTypeName, input.statusFlag, input.memo ?? '', typeId)

  return info.changes > 0 ? getArcType(typeId) : null
}

export function deleteArcType(typeId: string): number {
  // 同时删除关联的字段定义
  const db = getDatabase()
  const tx = db.transaction((id: string): number => {
    db.prepare('DELETE FROM arcFieldInfo WHERE arcTypeId = ?').run(id)
    return db.prepare('DELETE FROM arcType WHERE typeId = ?').run(id).changes
  })
  return tx(typeId)
}
