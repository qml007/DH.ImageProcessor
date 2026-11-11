import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'
import { deleteArcImageByArc } from './arcImage'
import { deleteArcFieldValueByArc } from './arcFieldValue'

export const ARC_STATUS_IN_PROGRESS = 0
export const ARC_STATUS_COMPLETED = 1

export interface ArcInfoRow {
  arcId: string
  batId: string
  arcName: string
  sortNo: number
  status: number
  timeOfCreate: string
  memo: string
}

export interface ArcInfoInput {
  batId: string
  arcName: string
  sortNo?: number
  status?: number
  timeOfCreate?: string
  memo?: string
}

type RawRow = {
  arcId: string
  batId: string
  arcName: string
  sortNo: number
  status: number
  timeOfCreate: string
  memo: string | null
}

const mapRow = (row: RawRow): ArcInfoRow => ({
  arcId: row.arcId,
  batId: row.batId,
  arcName: row.arcName,
  sortNo: row.sortNo,
  status: row.status,
  timeOfCreate: row.timeOfCreate,
  memo: row.memo ?? ''
})

const SELECT_COLS = 'arcId, batId, arcName, sortNo, status, timeOfCreate, memo'

export function listArcInfo(batId: string): ArcInfoRow[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcInfo WHERE batId = ? ORDER BY sortNo, arcName`)
    .all(batId) as RawRow[]

  return rows.map(mapRow)
}

export function getArcInfo(arcId: string): ArcInfoRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcInfo WHERE arcId = ?`)
    .get(arcId) as RawRow | undefined

  return row ? mapRow(row) : null
}

/** 同批次内重名校验 */
export function arcNameExists(batId: string, arcName: string, excludeArcId?: string): boolean {
  const row = getDatabase()
    .prepare('SELECT arcId FROM arcInfo WHERE batId = ? AND arcName = ? AND arcId <> ?')
    .get(batId, arcName, excludeArcId ?? '') as { arcId: string } | undefined

  return Boolean(row)
}

export function createArcInfo(input: ArcInfoInput): ArcInfoRow {
  const db = getDatabase()
  const arcId = generateSnowflakeId()
  db.prepare(
    `INSERT INTO arcInfo (arcId, batId, arcName, sortNo, status, timeOfCreate, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    arcId,
    input.batId,
    input.arcName,
    input.sortNo ?? 0,
    input.status ?? ARC_STATUS_IN_PROGRESS,
    input.timeOfCreate ?? new Date().toISOString(),
    input.memo ?? ''
  )

  return getArcInfo(arcId)!
}

export function updateArcInfo(
  arcId: string,
  input: Partial<Omit<ArcInfoInput, 'batId' | 'timeOfCreate'>>
): ArcInfoRow | null {
  const existing = getArcInfo(arcId)
  if (!existing) return null

  getDatabase()
    .prepare('UPDATE arcInfo SET arcName = ?, sortNo = ?, status = ?, memo = ? WHERE arcId = ?')
    .run(
      input.arcName ?? existing.arcName,
      input.sortNo ?? existing.sortNo,
      input.status ?? existing.status,
      input.memo ?? existing.memo,
      arcId
    )

  return getArcInfo(arcId)
}

/** 删除档案：级联删除其图像、历史版本与字段值 */
export function deleteArcInfo(arcId: string): number {
  const db = getDatabase()
  const tx = db.transaction((): number => {
    deleteArcImageByArc(arcId)
    deleteArcFieldValueByArc(arcId)
    return db.prepare('DELETE FROM arcInfo WHERE arcId = ?').run(arcId).changes
  })
  return tx()
}

/** 删除某批次下的全部档案（批次删除时使用） */
export function deleteArcInfoByBat(batId: string): number {
  const db = getDatabase()
  const tx = db.transaction((): number => {
    const ids = db.prepare('SELECT arcId FROM arcInfo WHERE batId = ?').all(batId) as Array<{
      arcId: string
    }>
    for (const { arcId } of ids) {
      deleteArcImageByArc(arcId)
      deleteArcFieldValueByArc(arcId)
    }
    return db.prepare('DELETE FROM arcInfo WHERE batId = ?').run(batId).changes
  })
  return tx()
}
