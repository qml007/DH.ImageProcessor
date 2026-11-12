import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'

export interface ArcImageOcrRow {
  ocrId: string
  imageId: string
  historyId: string
  imageWidth: number
  imageHeight: number
  text: string
  blocksJson: string
  engine: string
  timeOfCreate: string
}

export interface ArcImageOcrInput {
  imageId: string
  historyId?: string
  imageWidth: number
  imageHeight: number
  text: string
  blocksJson: string
  engine?: string
  timeOfCreate?: string
}

type RawRow = {
  ocrId: string
  imageId: string
  historyId: string
  imageWidth: number
  imageHeight: number
  text: string | null
  blocksJson: string | null
  engine: string | null
  timeOfCreate: string
}

const SELECT_COLS =
  'ocrId, imageId, historyId, imageWidth, imageHeight, text, blocksJson, engine, timeOfCreate'

const mapRow = (row: RawRow): ArcImageOcrRow => ({
  ocrId: row.ocrId,
  imageId: row.imageId,
  historyId: row.historyId,
  imageWidth: row.imageWidth,
  imageHeight: row.imageHeight,
  text: row.text ?? '',
  blocksJson: row.blocksJson ?? '[]',
  engine: row.engine ?? '',
  timeOfCreate: row.timeOfCreate
})

export function getArcImageOcr(imageId: string, historyId = ''): ArcImageOcrRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcImageOcr WHERE imageId = ? AND historyId = ?`)
    .get(imageId, historyId) as RawRow | undefined

  return row ? mapRow(row) : null
}

/** 同一图像版本只保留一份 OCR 结果，重复识别时覆盖 */
export function saveArcImageOcr(input: ArcImageOcrInput): ArcImageOcrRow {
  const db = getDatabase()
  const historyId = input.historyId ?? ''

  db.prepare(
    `INSERT INTO arcImageOcr (ocrId, imageId, historyId, imageWidth, imageHeight, text, blocksJson, engine, timeOfCreate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(imageId, historyId) DO UPDATE SET
       imageWidth = excluded.imageWidth,
       imageHeight = excluded.imageHeight,
       text = excluded.text,
       blocksJson = excluded.blocksJson,
       engine = excluded.engine,
       timeOfCreate = excluded.timeOfCreate`
  ).run(
    generateSnowflakeId(),
    input.imageId,
    historyId,
    input.imageWidth,
    input.imageHeight,
    input.text,
    input.blocksJson,
    input.engine ?? '',
    input.timeOfCreate ?? new Date().toISOString()
  )

  return getArcImageOcr(input.imageId, historyId)!
}

export function deleteArcImageOcrByImage(imageId: string): number {
  return getDatabase().prepare('DELETE FROM arcImageOcr WHERE imageId = ?').run(imageId).changes
}

export function deleteArcImageOcrByArc(arcId: string): number {
  return getDatabase()
    .prepare(
      'DELETE FROM arcImageOcr WHERE imageId IN (SELECT imageId FROM arcImage WHERE arcId = ?)'
    )
    .run(arcId).changes
}

export function deleteArcImageOcrByHistory(imageId: string, historyIds: string[]): number {
  if (!historyIds.length) return 0

  const placeholders = historyIds.map(() => '?').join(', ')
  return getDatabase()
    .prepare(`DELETE FROM arcImageOcr WHERE imageId = ? AND historyId IN (${placeholders})`)
    .run(imageId, ...historyIds).changes
}
