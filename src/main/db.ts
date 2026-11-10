import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export const DB_FILE_NAME = 'imageProcessor.db'

const BUSY_TIMEOUT = 5000

export interface SystemConfigRow {
  configKey: string
  configValue: string
  memo: string
}

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

let database: Database.Database | null = null
let resolvedPath = ''

// 数据库随当前系统用户隔离，放在 Electron 的 userData 目录下
export const databasePath = (): string => join(app.getPath('userData'), DB_FILE_NAME)

// 安装包内随程序分发的种子数据库（首次运行复制到 userData）
const seedDatabasePath = (): string =>
  is.dev
    ? join(__dirname, '../../src/renderer/public', DB_FILE_NAME)
    : join(__dirname, '../renderer', DB_FILE_NAME)

const createSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS systemconfig (
      configKey TEXT PRIMARY KEY NOT NULL,
      configValue TEXT,
      memo TEXT
    );

    CREATE TABLE IF NOT EXISTS arcType (
      typeId TEXT PRIMARY KEY NOT NULL,
      arcTypeCode TEXT NOT NULL,
      arcTypeName TEXT NOT NULL,
      statusFlag INTEGER NOT NULL DEFAULT 1,
      memo TEXT
    );

    CREATE TABLE IF NOT EXISTS arcFieldInfo (
      fieldId TEXT PRIMARY KEY NOT NULL,
      arcTypeId TEXT NOT NULL,
      sortNo INTEGER NOT NULL DEFAULT 0,
      fieldName TEXT NOT NULL,
      fieldType TEXT NOT NULL,
      isRequired INTEGER NOT NULL DEFAULT 0,
      memo TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_arcFieldInfo_arcTypeId ON arcFieldInfo(arcTypeId);
  `)
}

const openDatabase = (file: string): Database.Database => {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT}`)
  db.pragma('synchronous = NORMAL')
  createSchema(db)
  return db
}

export function getDatabase(): Database.Database {
  if (database) return database

  const file = databasePath()
  mkdirSync(app.getPath('userData'), { recursive: true })

  if (!existsSync(file)) {
    const seed = seedDatabasePath()
    if (existsSync(seed)) {
      writeFileSync(file, readFileSync(seed))
    }
  }

  database = openDatabase(file)
  resolvedPath = file
  return database
}

export function initializeDatabase(): { ok: boolean; path: string; message?: string } {
  try {
    const db = getDatabase()
    return { ok: true, path: db.name }
  } catch (error) {
    console.error('Failed to initialize database:', error)
    return {
      ok: false,
      path: resolvedPath || databasePath(),
      message: error instanceof Error ? error.message : '数据库初始化失败'
    }
  }
}

export function closeDatabase(): void {
  if (!database) return

  try {
    database.close()
  } catch (error) {
    console.error('Failed to close database:', error)
  } finally {
    database = null
  }
}

// ---------- 工具：10位随机唯一数字主键 ----------

const generate10DigitId = (): string => {
  // crypto 生成 4 字节无符号整数，再用 Math.random 补齐；循环直到库里不冲突
  const rand = () => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0]
  }
  const db = getDatabase()

  for (let i = 0; i < 100; i++) {
    // 保留前 10 位，避免前导零概率（用 10^9 ~ 10^10-1 区间）
    const id = String((rand() % 9000000000) + 1000000000)
    const exists = db.prepare("SELECT 1 FROM arcType WHERE typeId = ? UNION ALL SELECT 1 FROM arcFieldInfo WHERE fieldId = ? LIMIT 1")
      .get(id, id)
    if (!exists) return id
  }

  // 极端冲突兜底
  let fallback: string
  do {
    fallback = String(Math.floor(Math.random() * 9000000000) + 1000000000)
  } while (
    db.prepare("SELECT 1 FROM arcType WHERE typeId = ? UNION ALL SELECT 1 FROM arcFieldInfo WHERE fieldId = ? LIMIT 1")
      .get(fallback, fallback)
  )
  return fallback
}

// ---------- systemconfig ----------

export function listConfig(): SystemConfigRow[] {
  const rows = getDatabase()
    .prepare('SELECT configKey, configValue, memo FROM systemconfig ORDER BY configKey')
    .all() as Array<{ configKey: string; configValue: string | null; memo: string | null }>

  return rows.map((row) => ({
    configKey: row.configKey,
    configValue: row.configValue ?? '',
    memo: row.memo ?? ''
  }))
}

export function getConfig(configKey: string): SystemConfigRow | null {
  const row = getDatabase()
    .prepare('SELECT configKey, configValue, memo FROM systemconfig WHERE configKey = ?')
    .get(configKey) as { configKey: string; configValue: string | null; memo: string | null } | undefined

  if (!row) return null

  return {
    configKey: row.configKey,
    configValue: row.configValue ?? '',
    memo: row.memo ?? ''
  }
}

export function setConfig(configKey: string, configValue: string, memo?: string): void {
  const db = getDatabase()

  if (memo === undefined) {
    db.prepare(
      `INSERT INTO systemconfig (configKey, configValue, memo) VALUES (?, ?, '')
       ON CONFLICT(configKey) DO UPDATE SET configValue = excluded.configValue`
    ).run(configKey, configValue)
    return
  }

  db.prepare(
    `INSERT INTO systemconfig (configKey, configValue, memo) VALUES (?, ?, ?)
     ON CONFLICT(configKey) DO UPDATE SET
       configValue = excluded.configValue,
       memo = excluded.memo`
  ).run(configKey, configValue, memo)
}

export function deleteConfig(configKey: string): number {
  return getDatabase().prepare('DELETE FROM systemconfig WHERE configKey = ?').run(configKey)
    .changes
}

// ---------- arcType 档案类型 ----------

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
        .prepare('SELECT typeId, arcTypeCode, arcTypeName, statusFlag, memo FROM arcType ORDER BY statusFlag DESC, arcTypeCode')
        .all()
    : db
        .prepare('SELECT typeId, arcTypeCode, arcTypeName, statusFlag, memo FROM arcType WHERE statusFlag = 1 ORDER BY arcTypeCode')
        .all()

  return (rows as Array<any>).map(mapArcTypeRow)
}

export function getArcType(typeId: string): ArcTypeRow | null {
  const row = getDatabase()
    .prepare('SELECT typeId, arcTypeCode, arcTypeName, statusFlag, memo FROM arcType WHERE typeId = ?')
    .get(typeId) as any

  return row ? mapArcTypeRow(row) : null
}

export function createArcType(input: ArcTypeInput): ArcTypeRow {
  const db = getDatabase()
  const typeId = generate10DigitId()
  db.prepare(
    `INSERT INTO arcType (typeId, arcTypeCode, arcTypeName, statusFlag, memo)
     VALUES (?, ?, ?, ?, ?)`
  ).run(typeId, input.arcTypeCode, input.arcTypeName, input.statusFlag, input.memo ?? '')
  return getArcType(typeId)!
}

export function updateArcType(typeId: string, input: ArcTypeInput): ArcTypeRow | null {
  const db = getDatabase()
  const info = db.prepare(
    `UPDATE arcType SET arcTypeCode = ?, arcTypeName = ?, statusFlag = ?, memo = ?
     WHERE typeId = ?`
  ).run(input.arcTypeCode, input.arcTypeName, input.statusFlag, input.memo ?? '', typeId)

  return info.changes > 0 ? getArcType(typeId) : null
}

export function deleteArcType(typeId: string): number {
  // 同时删除关联的字段定义
  const db = getDatabase()
  const tx = db.transaction((id: string) => {
    db.prepare('DELETE FROM arcFieldInfo WHERE arcTypeId = ?').run(id)
    return db.prepare('DELETE FROM arcType WHERE typeId = ?').run(id).changes
  })
  return tx(typeId)
}

// ---------- arcFieldInfo 档案类型字段 ----------

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

export function listArcFieldInfo(arcTypeId: string): ArcFieldInfoRow[] {
  const rows = getDatabase()
    .prepare(
      'SELECT fieldId, arcTypeId, sortNo, fieldName, fieldType, isRequired, memo FROM arcFieldInfo WHERE arcTypeId = ? ORDER BY sortNo, fieldName'
    )
    .all(arcTypeId) as any[]

  return rows.map(mapArcFieldRow)
}

export function createArcFieldInfo(input: ArcFieldInfoInput): ArcFieldInfoRow {
  const db = getDatabase()
  const fieldId = generate10DigitId()
  db.prepare(
    `INSERT INTO arcFieldInfo (fieldId, arcTypeId, sortNo, fieldName, fieldType, isRequired, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(fieldId, input.arcTypeId, input.sortNo, input.fieldName, input.fieldType, input.isRequired, input.memo ?? '')
  return db.prepare('SELECT * FROM arcFieldInfo WHERE fieldId = ?').get(fieldId) as ArcFieldInfoRow
}

export function updateArcFieldInfo(fieldId: string, input: ArcFieldInfoInput): ArcFieldInfoRow | null {
  const db = getDatabase()
  const info = db.prepare(
    `UPDATE arcFieldInfo SET arcTypeId = ?, sortNo = ?, fieldName = ?, fieldType = ?, isRequired = ?, memo = ?
     WHERE fieldId = ?`
  ).run(input.arcTypeId, input.sortNo, input.fieldName, input.fieldType, input.isRequired, input.memo ?? '', fieldId)

  return info.changes > 0
    ? (db.prepare('SELECT * FROM arcFieldInfo WHERE fieldId = ?').get(fieldId) as ArcFieldInfoRow)
    : null
}

export function deleteArcFieldInfo(fieldId: string): number {
  return getDatabase().prepare('DELETE FROM arcFieldInfo WHERE fieldId = ?').run(fieldId).changes
}
