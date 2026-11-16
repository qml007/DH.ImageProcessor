import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export const DB_FILE_NAME = 'imageProcessor.db'

const BUSY_TIMEOUT = 5000

let database: Database.Database | null = null
let resolvedPath = ''

// 数据库随当前系统用户隔离，放在 Electron 的 userData 目录下
export const databasePath = (): string => join(app.getPath('userData'), DB_FILE_NAME)

// 安装包内随程序分发的种子数据库（首次运行复制到 userData）
// 注意：主进程被打包为单文件 out/main/index.js，__dirname 始终是 out/main，与源文件层级无关
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

    CREATE TABLE IF NOT EXISTS batInfo (
      batId TEXT PRIMARY KEY NOT NULL,
      batCode TEXT NOT NULL,
      arcTypeId TEXT NOT NULL,
      arcTypeName TEXT NOT NULL,
      timeOfCreate TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      sortNo INTEGER NOT NULL DEFAULT 0,
      bgColor TEXT NOT NULL DEFAULT '#FFFFFF',
      memo TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_batInfo_arcTypeId ON batInfo(arcTypeId);

    CREATE TABLE IF NOT EXISTS batArcFieldInfo (
      id TEXT PRIMARY KEY NOT NULL,
      batId TEXT NOT NULL,
      sortNo INTEGER NOT NULL DEFAULT 0,
      fieldName TEXT NOT NULL,
      fieldType TEXT NOT NULL,
      isRequired INTEGER NOT NULL DEFAULT 0,
      memo TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_batArcFieldInfo_batId ON batArcFieldInfo(batId);

    CREATE TABLE IF NOT EXISTS arcInfo (
      arcId TEXT PRIMARY KEY NOT NULL,
      batId TEXT NOT NULL,
      arcName TEXT NOT NULL,
      sortNo INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 0,
      timeOfCreate TEXT NOT NULL,
      memo TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_arcInfo_bat_name ON arcInfo(batId, arcName);

    CREATE TABLE IF NOT EXISTS arcImage (
      imageId TEXT PRIMARY KEY NOT NULL,
      arcId TEXT NOT NULL,
      sortNo INTEGER NOT NULL DEFAULT 0,
      sourcePath TEXT NOT NULL,
      fileName TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      isPdf INTEGER NOT NULL DEFAULT 0,
      pdfPageIndex INTEGER NOT NULL DEFAULT 0,
      pdfPageCount INTEGER NOT NULL DEFAULT 0,
      currentHistoryId TEXT,
      rotation REAL NOT NULL DEFAULT 0,
      timeOfCreate TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_arcImage_arcId ON arcImage(arcId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_arcImage_source
      ON arcImage(arcId, sourcePath, pdfPageIndex);

    CREATE TABLE IF NOT EXISTS arcImageHistory (
      historyId TEXT PRIMARY KEY NOT NULL,
      imageId TEXT NOT NULL,
      seqNo INTEGER NOT NULL,
      tempRelPath TEXT NOT NULL,
      rotation REAL NOT NULL DEFAULT 0,
      actionLabel TEXT,
      timeOfCreate TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_arcImageHistory_imageId ON arcImageHistory(imageId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_arcImageHistory_seq ON arcImageHistory(imageId, seqNo);

    CREATE TABLE IF NOT EXISTS arcImageOcr (
      ocrId TEXT PRIMARY KEY NOT NULL,
      imageId TEXT NOT NULL,
      historyId TEXT NOT NULL DEFAULT '',
      imageWidth INTEGER NOT NULL DEFAULT 0,
      imageHeight INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      blocksJson TEXT NOT NULL DEFAULT '[]',
      engine TEXT NOT NULL DEFAULT '',
      timeOfCreate TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_arcImageOcr_imageId ON arcImageOcr(imageId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_arcImageOcr_image_history
      ON arcImageOcr(imageId, historyId);

    CREATE TABLE IF NOT EXISTS arcFieldValue (
      valueId TEXT PRIMARY KEY NOT NULL,
      arcId TEXT NOT NULL,
      batFieldId TEXT NOT NULL,
      fieldName TEXT NOT NULL,
      fieldValue TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_arcFieldValue_arcId ON arcFieldValue(arcId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_arcFieldValue_arc_field
      ON arcFieldValue(arcId, batFieldId);
  `)
}

// 存量库迁移：表已存在但缺列时补列（CREATE TABLE IF NOT EXISTS 不会修改已有表）
const ensureColumn = (
  db: Database.Database,
  table: string,
  column: string,
  columnDdl: string
): void => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`)
  }
}

const migrateSchema = (db: Database.Database): void => {
  ensureColumn(db, 'batInfo', 'memo', 'memo TEXT')
  ensureColumn(db, 'batInfo', 'bgColor', "bgColor TEXT NOT NULL DEFAULT '#FFFFFF'")
}

const openDatabase = (file: string): Database.Database => {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT}`)
  db.pragma('synchronous = NORMAL')
  createSchema(db)
  migrateSchema(db)
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
