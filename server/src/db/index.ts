import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../env.js'
import { SCHEMA_SQL } from './schema.js'

export const DATA_DIR = path.join(REPO_ROOT, 'data')
mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'writerai.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(SCHEMA_SQL)

// 轻量迁移：为 chapters 增加 outline（章节细纲）列
const chapterCols = db.prepare('PRAGMA table_info(chapters)').all() as Array<{ name: string }>
if (!chapterCols.some((c) => c.name === 'outline')) {
  db.exec("ALTER TABLE chapters ADD COLUMN outline TEXT NOT NULL DEFAULT ''")
}
