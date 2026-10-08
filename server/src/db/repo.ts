import { randomUUID } from 'node:crypto'
import { db } from './index.js'

export interface ProjectRow {
  id: string
  title: string
  synopsis: string
  global_summary: string
  style_note: string
  created_at: number
  updated_at: number
}

export interface ChapterRow {
  id: string
  project_id: string
  sort_order: number
  title: string
  content: string
  summary: string
  summary_locked: 0 | 1
  summarized_len: number
  created_at: number
  updated_at: number
}

export type ChapterMetaRow = Omit<ChapterRow, 'content'> & { content_length: number }

export interface LoreRow {
  id: string
  project_id: string
  type: 'character' | 'location' | 'item' | 'faction' | 'world' | 'other'
  name: string
  /** JSON 数组字符串 */
  aliases: string
  content: string
  current_state: string
  always_on: 0 | 1
  priority: number
  enabled: 0 | 1
  updated_at: number
}

const stmt = {
  listProjects: db.prepare<[], { id: string; title: string; created_at: number; updated_at: number }>(
    'SELECT id, title, created_at, updated_at FROM projects ORDER BY updated_at DESC',
  ),
  getProject: db.prepare<[string], ProjectRow>('SELECT * FROM projects WHERE id = ?'),
  insertProject: db.prepare(
    'INSERT INTO projects (id, title, synopsis, global_summary, style_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  touchProject: db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?'),

  listChapterMetas: db.prepare<[string], ChapterMetaRow>(
    `SELECT id, project_id, sort_order, title, summary, summary_locked, summarized_len,
            created_at, updated_at, length(content) AS content_length
     FROM chapters WHERE project_id = ? ORDER BY sort_order, created_at`,
  ),
  listChaptersFull: db.prepare<[string], ChapterRow>(
    'SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order, created_at',
  ),
  getChapter: db.prepare<[string], ChapterRow>('SELECT * FROM chapters WHERE id = ?'),
  insertChapter: db.prepare(
    'INSERT INTO chapters (id, project_id, sort_order, title, content, summary, summary_locked, summarized_len, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  deleteChapter: db.prepare('DELETE FROM chapters WHERE id = ?'),
  maxSortOrder: db.prepare<[string], { m: number }>(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM chapters WHERE project_id = ?',
  ),

  listLore: db.prepare<[string], LoreRow>(
    'SELECT * FROM lore_entries WHERE project_id = ? ORDER BY updated_at DESC',
  ),
  getLore: db.prepare<[string], LoreRow>('SELECT * FROM lore_entries WHERE id = ?'),
  insertLore: db.prepare(
    `INSERT INTO lore_entries (id, project_id, type, name, aliases, content, current_state, always_on, priority, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  deleteLore: db.prepare('DELETE FROM lore_entries WHERE id = ?'),

  insertSuggestionLog: db.prepare(
    'INSERT INTO suggestion_logs (id, project_id, chapter_id, outcome, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ),
}

function now(): number {
  return Date.now()
}

// ---------- projects ----------

export function listProjects() {
  return stmt.listProjects.all()
}

export function getProject(id: string): ProjectRow | undefined {
  return stmt.getProject.get(id)
}

export function createProject(title: string): ProjectRow {
  const t = now()
  const p: ProjectRow = {
    id: randomUUID(),
    title,
    synopsis: '',
    global_summary: '',
    style_note: '',
    created_at: t,
    updated_at: t,
  }
  stmt.insertProject.run(p.id, p.title, p.synopsis, p.global_summary, p.style_note, p.created_at, p.updated_at)
  createChapter(p.id, '第一章')
  return p
}

export interface ProjectPatch {
  title?: string
  synopsis?: string
  global_summary?: string
  style_note?: string
}

export function updateProject(id: string, patch: ProjectPatch): void {
  const p = stmt.getProject.get(id)
  if (!p) return
  const sets: string[] = []
  const params: unknown[] = []
  for (const key of ['title', 'synopsis', 'global_summary', 'style_note'] as const) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = ?`)
      params.push(v)
    }
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  params.push(now(), id)
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function deleteProject(id: string): void {
  stmt.deleteProject.run(id)
}

// ---------- chapters ----------

export function listChapterMetas(projectId: string): ChapterMetaRow[] {
  return stmt.listChapterMetas.all(projectId)
}

export function listChaptersFull(projectId: string): ChapterRow[] {
  return stmt.listChaptersFull.all(projectId)
}

export function getChapter(id: string): ChapterRow | undefined {
  return stmt.getChapter.get(id)
}

export function createChapter(projectId: string, title: string): ChapterRow {
  const t = now()
  const ch: ChapterRow = {
    id: randomUUID(),
    project_id: projectId,
    sort_order: (stmt.maxSortOrder.get(projectId)?.m ?? 0) + 1,
    title,
    content: '',
    summary: '',
    summary_locked: 0,
    summarized_len: 0,
    created_at: t,
    updated_at: t,
  }
  stmt.insertChapter.run(
    ch.id, ch.project_id, ch.sort_order, ch.title, ch.content, ch.summary,
    ch.summary_locked, ch.summarized_len, ch.created_at, ch.updated_at,
  )
  stmt.touchProject.run(t, projectId)
  return ch
}

const CHAPTER_PATCH_FIELDS = ['title', 'content', 'summary', 'summary_locked', 'sort_order', 'summarized_len'] as const

export interface ChapterPatch {
  title?: string
  content?: string
  summary?: string
  summary_locked?: 0 | 1
  sort_order?: number
  summarized_len?: number
}

export function updateChapter(id: string, patch: ChapterPatch): void {
  const ch = stmt.getChapter.get(id)
  if (!ch) return
  const sets: string[] = []
  const params: unknown[] = []
  for (const key of CHAPTER_PATCH_FIELDS) {
    const v = patch[key]
    if (v !== undefined) {
      sets.push(`${key} = ?`)
      params.push(v)
    }
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  params.push(now(), id)
  db.prepare(`UPDATE chapters SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  stmt.touchProject.run(now(), ch.project_id)
}

export function deleteChapter(id: string): void {
  const ch = stmt.getChapter.get(id)
  if (!ch) return
  stmt.deleteChapter.run(id)
  stmt.touchProject.run(now(), ch.project_id)
}

// ---------- lore ----------

export interface LoreCreate {
  type: LoreRow['type']
  name: string
  aliases: string[]
  content: string
  current_state: string
  always_on: boolean
  priority: number
  enabled: boolean
}

export function listLore(projectId: string): LoreRow[] {
  return stmt.listLore.all(projectId)
}

export function getLore(id: string): LoreRow | undefined {
  return stmt.getLore.get(id)
}

export function createLore(projectId: string, data: LoreCreate): LoreRow {
  const row: LoreRow = {
    id: randomUUID(),
    project_id: projectId,
    type: data.type,
    name: data.name,
    aliases: JSON.stringify(data.aliases),
    content: data.content,
    current_state: data.current_state,
    always_on: data.always_on ? 1 : 0,
    priority: data.priority,
    enabled: data.enabled ? 1 : 0,
    updated_at: now(),
  }
  stmt.insertLore.run(
    row.id, row.project_id, row.type, row.name, row.aliases, row.content,
    row.current_state, row.always_on, row.priority, row.enabled, row.updated_at,
  )
  stmt.touchProject.run(now(), projectId)
  return row
}

export interface LorePatch {
  type?: LoreRow['type']
  name?: string
  aliases?: string[]
  content?: string
  current_state?: string
  always_on?: boolean
  priority?: number
  enabled?: boolean
}

export function updateLore(id: string, patch: LorePatch): void {
  const row = stmt.getLore.get(id)
  if (!row) return
  const sets: string[] = []
  const params: unknown[] = []
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = ?`)
    params.push(v)
  }
  if (patch.type !== undefined) add('type', patch.type)
  if (patch.name !== undefined) add('name', patch.name)
  if (patch.aliases !== undefined) add('aliases', JSON.stringify(patch.aliases))
  if (patch.content !== undefined) add('content', patch.content)
  if (patch.current_state !== undefined) add('current_state', patch.current_state)
  if (patch.always_on !== undefined) add('always_on', patch.always_on ? 1 : 0)
  if (patch.priority !== undefined) add('priority', patch.priority)
  if (patch.enabled !== undefined) add('enabled', patch.enabled ? 1 : 0)
  if (sets.length === 0) return
  add('updated_at', now())
  params.push(id)
  db.prepare(`UPDATE lore_entries SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  stmt.touchProject.run(now(), row.project_id)
}

export function deleteLore(id: string): void {
  const row = stmt.getLore.get(id)
  if (!row) return
  stmt.deleteLore.run(id)
  stmt.touchProject.run(now(), row.project_id)
}

// ---------- suggestion logs ----------

export function logSuggestion(projectId: string, chapterId: string, outcome: 'accepted' | 'partial' | 'dismissed', latencyMs?: number): void {
  stmt.insertSuggestionLog.run(randomUUID(), projectId, chapterId, outcome, latencyMs ?? null, now())
}
