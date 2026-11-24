import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'
import { listArcFieldInfo } from './arcFieldInfo'

export interface BatArcFieldInfoRow {
  id: string
  batId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  defaultValue: string
  memo: string
}

export interface BatArcFieldInfoInput {
  batId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  defaultValue?: string
  memo?: string
}

const mapRow = (row: {
  id: string
  batId: string
  sortNo: number
  fieldName: string
  fieldType: string
  isRequired: number
  defaultValue: string | null
  memo: string | null
}): BatArcFieldInfoRow => ({
  id: row.id,
  batId: row.batId,
  sortNo: row.sortNo,
  fieldName: row.fieldName,
  fieldType: row.fieldType,
  isRequired: row.isRequired,
  defaultValue: row.defaultValue ?? '',
  memo: row.memo ?? ''
})

const SELECT_COLS = 'id, batId, sortNo, fieldName, fieldType, isRequired, defaultValue, memo'

export function listBatArcFieldInfo(batId: string): BatArcFieldInfoRow[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM batArcFieldInfo WHERE batId = ? ORDER BY sortNo, fieldName`)
    .all(batId) as Array<Parameters<typeof mapRow>[0]>

  return rows.map(mapRow)
}

export function getBatArcFieldInfo(id: string): BatArcFieldInfoRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM batArcFieldInfo WHERE id = ?`)
    .get(id) as Parameters<typeof mapRow>[0] | undefined

  return row ? mapRow(row) : null
}

export function createBatArcFieldInfo(input: BatArcFieldInfoInput): BatArcFieldInfoRow {
  const db = getDatabase()
  const id = generateSnowflakeId()
  db.prepare(
    `INSERT INTO batArcFieldInfo (id, batId, sortNo, fieldName, fieldType, isRequired, defaultValue, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.batId,
    input.sortNo,
    input.fieldName,
    input.fieldType,
    input.isRequired,
    input.defaultValue ?? '',
    input.memo ?? ''
  )
  return getBatArcFieldInfo(id)!
}

export function updateBatArcFieldInfo(
  id: string,
  input: BatArcFieldInfoInput
): BatArcFieldInfoRow | null {
  const db = getDatabase()
  const info = db
    .prepare(
      `UPDATE batArcFieldInfo SET batId = ?, sortNo = ?, fieldName = ?, fieldType = ?, isRequired = ?, defaultValue = ?, memo = ?
       WHERE id = ?`
    )
    .run(
      input.batId,
      input.sortNo,
      input.fieldName,
      input.fieldType,
      input.isRequired,
      input.defaultValue ?? '',
      input.memo ?? '',
      id
    )

  return info.changes > 0 ? getBatArcFieldInfo(id) : null
}

export function deleteBatArcFieldInfo(id: string): number {
  return getDatabase().prepare('DELETE FROM batArcFieldInfo WHERE id = ?').run(id).changes
}

export function deleteBatArcFieldInfoByBatId(batId: string): number {
  return getDatabase().prepare('DELETE FROM batArcFieldInfo WHERE batId = ?').run(batId).changes
}

/**
 * 把档案类型当前的字段定义快照到批次下。
 * 批次一旦建立，其字段相对固定，此后 arcFieldInfo 的变更不影响本批次。
 * 在事务内执行：先清空该批次已有快照，再整体写入。
 * 返回写入的字段条数。
 */
export function snapshotArcFieldsToBatch(batId: string, arcTypeId: string): number {
  const db = getDatabase()
  const fields = listArcFieldInfo(arcTypeId)

  const tx = db.transaction((): number => {
    db.prepare('DELETE FROM batArcFieldInfo WHERE batId = ?').run(batId)
    const insert = db.prepare(
      `INSERT INTO batArcFieldInfo (id, batId, sortNo, fieldName, fieldType, isRequired, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const f of fields) {
      insert.run(
        generateSnowflakeId(),
        batId,
        f.sortNo,
        f.fieldName,
        f.fieldType,
        f.isRequired,
        f.memo
      )
    }
    return fields.length
  })

  return tx()
}
