import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'
import { deleteArcImageOcrByHistory } from './arcImageOcr'

export interface ArcImageHistoryRow {
  historyId: string
  imageId: string
  seqNo: number
  tempRelPath: string
  rotation: number
  actionLabel: string
  timeOfCreate: string
}

export interface ArcImageHistoryInput {
  imageId: string
  seqNo: number
  tempRelPath: string
  rotation: number
  actionLabel?: string
  timeOfCreate?: string
}

type RawRow = {
  historyId: string
  imageId: string
  seqNo: number
  tempRelPath: string
  rotation: number
  actionLabel: string | null
  timeOfCreate: string
}

const mapRow = (row: RawRow): ArcImageHistoryRow => ({
  historyId: row.historyId,
  imageId: row.imageId,
  seqNo: row.seqNo,
  tempRelPath: row.tempRelPath,
  rotation: row.rotation,
  actionLabel: row.actionLabel ?? '',
  timeOfCreate: row.timeOfCreate
})

const SELECT_COLS =
  'historyId, imageId, seqNo, tempRelPath, rotation, actionLabel, timeOfCreate'

export function listArcImageHistory(imageId: string): ArcImageHistoryRow[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcImageHistory WHERE imageId = ? ORDER BY seqNo`)
    .all(imageId) as RawRow[]

  return rows.map(mapRow)
}

export function getArcImageHistory(historyId: string): ArcImageHistoryRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcImageHistory WHERE historyId = ?`)
    .get(historyId) as RawRow | undefined

  return row ? mapRow(row) : null
}

export function createArcImageHistory(input: ArcImageHistoryInput): ArcImageHistoryRow {
  const db = getDatabase()
  const historyId = generateSnowflakeId()
  db.prepare(
    `INSERT INTO arcImageHistory (historyId, imageId, seqNo, tempRelPath, rotation, actionLabel, timeOfCreate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    historyId,
    input.imageId,
    input.seqNo,
    input.tempRelPath,
    input.rotation,
    input.actionLabel ?? '',
    input.timeOfCreate ?? new Date().toISOString()
  )

  return getArcImageHistory(historyId)!
}

/** 撤销后产生新操作时，丢弃该版本之后的所有历史记录，返回被丢弃的记录 */
export function truncateArcImageHistory(imageId: string, seqNo: number): ArcImageHistoryRow[] {
  const db = getDatabase()
  const discarded = db
    .prepare(
      `SELECT ${SELECT_COLS} FROM arcImageHistory WHERE imageId = ? AND seqNo > ? ORDER BY seqNo`
    )
    .all(imageId, seqNo) as RawRow[]

  db.prepare('DELETE FROM arcImageHistory WHERE imageId = ? AND seqNo > ?').run(imageId, seqNo)
  deleteArcImageOcrByHistory(
    imageId,
    discarded.map((item) => item.historyId)
  )
  return discarded.map(mapRow)
}

export function deleteArcImageHistory(historyId: string): number {
  return getDatabase().prepare('DELETE FROM arcImageHistory WHERE historyId = ?').run(historyId)
    .changes
}

export function deleteArcImageHistoryByImage(imageId: string): number {
  return getDatabase().prepare('DELETE FROM arcImageHistory WHERE imageId = ?').run(imageId)
    .changes
}
