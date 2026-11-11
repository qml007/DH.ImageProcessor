import { getDatabase } from './connection'
import { generateSnowflakeId, BAT_STATUS_IN_PROGRESS } from './common'
import { getArcType } from './arcType'
import { listArcFieldInfo } from './arcFieldInfo'
import { deleteBatArcFieldInfoByBatId, snapshotArcFieldsToBatch } from './batArcFieldInfo'
import { deleteArcInfoByBat } from './arcInfo'

export interface BatInfoRow {
  batId: string
  batCode: string
  arcTypeId: string
  arcTypeName: string
  timeOfCreate: string
  status: number
  sortNo: number
  memo: string
}

export interface BatInfoInput {
  /** 不传则自动生成 b_yyyymmdd_xxx */
  batCode?: string
  arcTypeId: string
  /** 不传则从 arcType 表按 arcTypeId 取名称 */
  arcTypeName?: string
  /** 不传则取当前时间 ISO 字符串 */
  timeOfCreate?: string
  /** 默认 0（进行中） */
  status?: number
  /** 默认 0 */
  sortNo?: number
  memo?: string
}

const mapBatInfoRow = (row: {
  batId: string
  batCode: string
  arcTypeId: string
  arcTypeName: string
  timeOfCreate: string
  status: number
  sortNo: number
  memo: string | null
}): BatInfoRow => ({
  batId: row.batId,
  batCode: row.batCode,
  arcTypeId: row.arcTypeId,
  arcTypeName: row.arcTypeName,
  timeOfCreate: row.timeOfCreate,
  status: row.status,
  sortNo: row.sortNo,
  memo: row.memo ?? ''
})

const SELECT_COLS = 'batId, batCode, arcTypeId, arcTypeName, timeOfCreate, status, sortNo, memo'

// 生成当日批次编号：b_yyyymmdd_xxx，xxx 为当日序号（3 位补零）
// 调用方须在事务内使用，保证 count 与 insert 之间无并发插入
const nextBatCode = (prefix: string): string => {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM batInfo WHERE batCode LIKE ?`)
    .get(`${prefix}_%`) as { cnt: number }
  return `${prefix}_${String(row.cnt + 1).padStart(3, '0')}`
}

export const batCodePrefixOfToday = (): string => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `b_${y}${m}${d}`
}

export function listBatInfo(arcTypeId?: string): BatInfoRow[] {
  const db = getDatabase()
  const rows = (
    arcTypeId
      ? db
          .prepare(`SELECT ${SELECT_COLS} FROM batInfo WHERE arcTypeId = ? ORDER BY timeOfCreate DESC, batCode DESC`)
          .all(arcTypeId)
      : db
          .prepare(`SELECT ${SELECT_COLS} FROM batInfo ORDER BY timeOfCreate DESC, batCode DESC`)
          .all()
  ) as Array<Parameters<typeof mapBatInfoRow>[0]>

  return rows.map(mapBatInfoRow)
}

export function getBatInfo(batId: string): BatInfoRow | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM batInfo WHERE batId = ?`)
    .get(batId) as Parameters<typeof mapBatInfoRow>[0] | undefined

  return row ? mapBatInfoRow(row) : null
}

export function createBatInfo(input: BatInfoInput): BatInfoRow {
  const db = getDatabase()

  const arcTypeName =
    input.arcTypeName ?? getArcType(input.arcTypeId)?.arcTypeName
  if (!arcTypeName) {
    throw new Error(`档案类型不存在：${input.arcTypeId}`)
  }

  const tx = db.transaction((): string => {
    const batId = generateSnowflakeId()
    const batCode = input.batCode?.trim() || nextBatCode(batCodePrefixOfToday())
    const timeOfCreate = input.timeOfCreate ?? new Date().toISOString()

    db.prepare(
      `INSERT INTO batInfo (batId, batCode, arcTypeId, arcTypeName, timeOfCreate, status, sortNo, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      batId,
      batCode,
      input.arcTypeId,
      arcTypeName,
      timeOfCreate,
      input.status ?? BAT_STATUS_IN_PROGRESS,
      input.sortNo ?? 0,
      input.memo ?? ''
    )
    return batId
  })

  return getBatInfo(tx())!
}

export function updateBatInfo(
  batId: string,
  input: Omit<BatInfoInput, 'timeOfCreate'>
): BatInfoRow | null {
  const db = getDatabase()
  const existing = getBatInfo(batId)
  if (!existing) return null

  const arcTypeName =
    input.arcTypeName ??
    (input.arcTypeId !== existing.arcTypeId
      ? getArcType(input.arcTypeId)?.arcTypeName
      : existing.arcTypeName)
  if (!arcTypeName) {
    throw new Error(`档案类型不存在：${input.arcTypeId}`)
  }

  const info = db
    .prepare(
      `UPDATE batInfo SET batCode = ?, arcTypeId = ?, arcTypeName = ?, status = ?, sortNo = ?, memo = ?
       WHERE batId = ?`
    )
    .run(
      input.batCode?.trim() || existing.batCode,
      input.arcTypeId,
      arcTypeName,
      input.status ?? existing.status,
      input.sortNo ?? existing.sortNo,
      input.memo ?? existing.memo,
      batId
    )

  return info.changes > 0 ? getBatInfo(batId) : null
}

export function deleteBatInfo(batId: string): number {
  // 级联删除该批次的档案（含图像、历史版本）与字段快照
  const db = getDatabase()
  const tx = db.transaction((id: string): number => {
    deleteArcInfoByBat(id)
    db.prepare('DELETE FROM batArcFieldInfo WHERE batId = ?').run(id)
    return db.prepare('DELETE FROM batInfo WHERE batId = ?').run(id).changes
  })
  return tx(batId)
}

// ---------- 带字段快照的编排方法（页面增改批次时使用） ----------

/**
 * 创建批次并把档案类型的字段定义快照进 batArcFieldInfo。
 * 档案类型无任何字段时抛错，不创建批次。
 */
export function createBatInfoWithSnapshot(input: BatInfoInput): BatInfoRow {
  const fields = listArcFieldInfo(input.arcTypeId)
  if (fields.length === 0) {
    throw new Error('所选档案类型尚未定义任何字段，无法创建批次')
  }

  const db = getDatabase()
  const tx = db.transaction((): string => {
    const bat = createBatInfo(input)
    snapshotArcFieldsToBatch(bat.batId, input.arcTypeId)
    return bat.batId
  })

  return getBatInfo(tx())!
}

/**
 * 更新批次；若档案类型发生变化，先删除原快照再按新类型重新快照。
 * 新类型无任何字段时抛错，不执行修改。
 */
export function updateBatInfoWithSnapshot(
  batId: string,
  input: Omit<BatInfoInput, 'timeOfCreate'>
): BatInfoRow | null {
  const existing = getBatInfo(batId)
  if (!existing) return null

  const typeChanged = input.arcTypeId !== existing.arcTypeId
  if (typeChanged && listArcFieldInfo(input.arcTypeId).length === 0) {
    throw new Error('所选档案类型尚未定义任何字段，无法切换')
  }

  const db = getDatabase()
  const tx = db.transaction((): void => {
    updateBatInfo(batId, input)
    if (typeChanged) {
      deleteBatArcFieldInfoByBatId(batId)
      snapshotArcFieldsToBatch(batId, input.arcTypeId)
    }
  })
  tx()

  return getBatInfo(batId)
}
