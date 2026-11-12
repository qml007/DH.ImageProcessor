import { getDatabase } from './connection'
import { generateSnowflakeId } from './common'
import { deleteArcImageHistoryByImage } from './arcImageHistory'
import { deleteArcImageOcrByImage } from './arcImageOcr'

export interface ArcImageRow {
  imageId: string
  arcId: string
  sortNo: number
  sourcePath: string
  fileName: string
  ext: string
  size: number
  isPdf: number
  pdfPageIndex: number
  pdfPageCount: number
  currentHistoryId: string
  rotation: number
  timeOfCreate: string
}

export interface ArcImageInput {
  arcId: string
  sortNo: number
  sourcePath: string
  fileName: string
  ext: string
  size?: number
  isPdf?: number
  pdfPageIndex?: number
  pdfPageCount?: number
  timeOfCreate?: string
}

export interface ArcImagePatch {
  arcId?: string
  sortNo?: number
  currentHistoryId?: string | null
  rotation?: number
}

type RawRow = {
  imageId: string
  arcId: string
  sortNo: number
  sourcePath: string
  fileName: string
  ext: string
  size: number
  isPdf: number
  pdfPageIndex: number
  pdfPageCount: number
  currentHistoryId: string | null
  rotation: number
  timeOfCreate: string
}

const mapRow = (row: RawRow): ArcImageRow => ({
  imageId: row.imageId,
  arcId: row.arcId,
  sortNo: row.sortNo,
  sourcePath: row.sourcePath,
  fileName: row.fileName,
  ext: row.ext,
  size: row.size,
  isPdf: row.isPdf,
  pdfPageIndex: row.pdfPageIndex,
  pdfPageCount: row.pdfPageCount,
  currentHistoryId: row.currentHistoryId ?? '',
  rotation: row.rotation,
  timeOfCreate: row.timeOfCreate
})

const SELECT_COLS =
  'imageId, arcId, sortNo, sourcePath, fileName, ext, size, isPdf, pdfPageIndex, pdfPageCount, currentHistoryId, rotation, timeOfCreate'

export function listArcImage(arcId: string): ArcImageRow[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcImage WHERE arcId = ? ORDER BY sortNo, imageId`)
    .all(arcId) as RawRow[]

  return rows.map(mapRow)
}

export interface ArcImageCountRow {
  arcId: string
  count: number
}

/** 批量统计各档案的图像数量（进入页面时一次性计算） */
export function countArcImageByArcIds(arcIds: string[]): ArcImageCountRow[] {
  if (!arcIds.length) return []

  const placeholders = arcIds.map(() => '?').join(', ')
  return getDatabase()
    .prepare(
      `SELECT arcId, COUNT(*) AS count FROM arcImage WHERE arcId IN (${placeholders}) GROUP BY arcId`
    )
    .all(...arcIds) as ArcImageCountRow[]
}

export function getArcImage(imageId: string): ArcImageRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM arcImage WHERE imageId = ?`)
    .get(imageId) as RawRow | undefined

  return row ? mapRow(row) : null
}

export function createArcImage(input: ArcImageInput): ArcImageRow {
  const db = getDatabase()
  const imageId = generateSnowflakeId()
  db.prepare(
    `INSERT INTO arcImage (imageId, arcId, sortNo, sourcePath, fileName, ext, size, isPdf, pdfPageIndex, pdfPageCount, currentHistoryId, rotation, timeOfCreate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
  ).run(
    imageId,
    input.arcId,
    input.sortNo,
    input.sourcePath,
    input.fileName,
    input.ext,
    input.size ?? 0,
    input.isPdf ?? 0,
    input.pdfPageIndex ?? 0,
    input.pdfPageCount ?? 0,
    input.timeOfCreate ?? new Date().toISOString()
  )

  return getArcImage(imageId)!
}

/** 批量导入图像，事务内写入，返回写入后的行 */
export function createArcImageBatch(list: ArcImageInput[]): ArcImageRow[] {
  const db = getDatabase()
  const tx = db.transaction((): string[] => {
    return list.map((item) => createArcImage(item).imageId)
  })
  const ids = tx()
  return ids.map((id) => getArcImage(id)!).filter(Boolean)
}

export function updateArcImage(imageId: string, patch: ArcImagePatch): ArcImageRow | null {
  const existing = getArcImage(imageId)
  if (!existing) return null

  getDatabase()
    .prepare(
      `UPDATE arcImage SET arcId = ?, sortNo = ?, currentHistoryId = ?, rotation = ? WHERE imageId = ?`
    )
    .run(
      patch.arcId ?? existing.arcId,
      patch.sortNo ?? existing.sortNo,
      patch.currentHistoryId === undefined
        ? existing.currentHistoryId || null
        : patch.currentHistoryId,
      patch.rotation ?? existing.rotation,
      imageId
    )

  return getArcImage(imageId)
}

export function deleteArcImage(imageId: string): number {
  const db = getDatabase()
  const tx = db.transaction((): number => {
    deleteArcImageHistoryByImage(imageId)
    deleteArcImageOcrByImage(imageId)
    return db.prepare('DELETE FROM arcImage WHERE imageId = ?').run(imageId).changes
  })
  return tx()
}

export function deleteArcImageByArc(arcId: string): number {
  const db = getDatabase()
  const tx = db.transaction((): number => {
    const ids = db.prepare('SELECT imageId FROM arcImage WHERE arcId = ?').all(arcId) as Array<{
      imageId: string
    }>
    for (const { imageId } of ids) {
      deleteArcImageHistoryByImage(imageId)
      deleteArcImageOcrByImage(imageId)
    }
    return db.prepare('DELETE FROM arcImage WHERE arcId = ?').run(arcId).changes
  })
  return tx()
}
