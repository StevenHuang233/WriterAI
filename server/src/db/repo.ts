import { randomUUID } from 'node:crypto'
import { db } from './index.js'

export interface ProjectRow {
  id: string
  title: string
  synopsis: string
  global_summary: string
  style_note: string
  /** 从正文自动总结出的文风画像（可直接参与的提词指令） */
  style_profile: string
  /** 文风画像生成时间 */
  style_profile_at: number
  created_at: number
  updated_at: number
}

export interface ChapterRow {
  id: string
  project_id: string
  sort_order: number
  title: string
  content: string
  /** 章节细纲 */
  outline: string
  summary: string
  /** 一句话摘要（中等压缩） */
  summary_brief: string
  /** 极简摘要（高压缩） */
  summary_micro: string
  summary_locked: 0 | 1
  summarized_len: number
  created_at: number
  updated_at: number
}

export interface SnapshotRow {
  id: string
  chapter_id: string
  content: string
  label: string
  created_at: number
}

export interface StatRow {
  id: string
  project_id: string
  chapter_id: string
  day: string
  delta: number
  created_at: number
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
    `SELECT id, project_id, sort_order, title, outline, summary, summary_brief, summary_micro,
            summary_locked, summarized_len, created_at, updated_at, length(content) AS content_length
     FROM chapters WHERE project_id = ? ORDER BY sort_order, created_at`,
  ),
  listChaptersFull: db.prepare<[string], ChapterRow>(
    'SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order, created_at',
  ),
  getChapter: db.prepare<[string], ChapterRow>('SELECT * FROM chapters WHERE id = ?'),
  insertChapter: db.prepare(
    'INSERT INTO chapters (id, project_id, sort_order, title, content, outline, summary, summary_locked, summarized_len, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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

  insertSnapshot: db.prepare(
    'INSERT INTO chapter_snapshots (id, chapter_id, content, label, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  listSnapshots: db.prepare<[string], SnapshotMeta>(
    'SELECT id, chapter_id, label, length(content) AS length, created_at FROM chapter_snapshots WHERE chapter_id = ? ORDER BY created_at DESC',
  ),
  getSnapshot: db.prepare<[string], SnapshotRow>('SELECT * FROM chapter_snapshots WHERE id = ?'),
  deleteSnapshot: db.prepare('DELETE FROM chapter_snapshots WHERE id = ?'),
  snapshotIds: db.prepare<[string], { id: string }>(
    'SELECT id FROM chapter_snapshots WHERE chapter_id = ? ORDER BY created_at DESC',
  ),
  insertStat: db.prepare(
    'INSERT INTO writing_stats (id, project_id, chapter_id, day, delta, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  statsByDay: db.prepare<[string], { day: string; chars: number }>(
    'SELECT day, SUM(delta) AS chars FROM writing_stats WHERE project_id = ? GROUP BY day ORDER BY day',
  ),

  getContextSettings: db.prepare<[string], {
    project_id: string
    disabled_blocks: string
    excluded_chapters: string
    pinned_chapters: string
    locked_nodes: string
    group_size: number
  }>('SELECT * FROM project_context_settings WHERE project_id = ?'),
  upsertContextSettings: db.prepare(`
    INSERT INTO project_context_settings (project_id, disabled_blocks, excluded_chapters, pinned_chapters, locked_nodes, group_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      disabled_blocks = excluded.disabled_blocks,
      excluded_chapters = excluded.excluded_chapters,
      pinned_chapters = excluded.pinned_chapters,
      locked_nodes = excluded.locked_nodes,
      group_size = excluded.group_size,
      updated_at = excluded.updated_at
  `),

  listSegments: db.prepare<[string, number], SegmentRow>(
    'SELECT * FROM chapter_segments WHERE project_id = ? AND size = ? ORDER BY start_order',
  ),
  deleteSegments: db.prepare('DELETE FROM chapter_segments WHERE project_id = ? AND size = ?'),
  upsertSegment: db.prepare(`
    INSERT INTO chapter_segments (project_id, size, start_order, end_order, chapter_ids, text, source_hash, updated_at)
    VALUES (@project_id, @size, @start_order, @end_order, @chapter_ids, @text, @source_hash, @updated_at)
    ON CONFLICT(project_id, size, start_order) DO UPDATE SET
      end_order = excluded.end_order, chapter_ids = excluded.chapter_ids,
      text = excluded.text, source_hash = excluded.source_hash, updated_at = excluded.updated_at
  `),

  getProfile: db.prepare<[string], CharacterProfileRow>('SELECT * FROM character_profiles WHERE lore_id = ?'),
  listProfiles: db.prepare<[string], CharacterProfileRow>(
    'SELECT * FROM character_profiles WHERE project_id = ?',
  ),
  upsertProfile: db.prepare(`
    INSERT INTO character_profiles (lore_id, project_id, gender, age, role, appearance, personality, motivation, catchphrase, avatar, color, updated_at)
    VALUES (@lore_id, @project_id, @gender, @age, @role, @appearance, @personality, @motivation, @catchphrase, @avatar, @color, @updated_at)
    ON CONFLICT(lore_id) DO UPDATE SET
      gender = excluded.gender, age = excluded.age, role = excluded.role, appearance = excluded.appearance,
      personality = excluded.personality, motivation = excluded.motivation, catchphrase = excluded.catchphrase,
      avatar = excluded.avatar, color = excluded.color, updated_at = excluded.updated_at
  `),
  listRelations: db.prepare<[string], CharacterRelationRow>(
    'SELECT * FROM character_relations WHERE project_id = ? ORDER BY updated_at DESC',
  ),
  insertRelation: db.prepare(
    'INSERT INTO character_relations (id, project_id, a_lore_id, b_lore_id, label, updated_at) VALUES (@id, @project_id, @a_lore_id, @b_lore_id, @label, @updated_at)',
  ),
  deleteRelation: db.prepare('DELETE FROM character_relations WHERE id = ?'),
  insertStateHistory: db.prepare(
    'INSERT INTO character_state_history (id, lore_id, chapter_id, chapter_title, state, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  listStateHistory: db.prepare<[string], CharacterStateRow>(
    'SELECT * FROM character_state_history WHERE lore_id = ? ORDER BY created_at DESC',
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
    style_profile: '',
    style_profile_at: 0,
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
  style_profile?: string
  style_profile_at?: number
}

export function updateProject(id: string, patch: ProjectPatch): void {
  const p = stmt.getProject.get(id)
  if (!p) return
  const sets: string[] = []
  const params: unknown[] = []
  for (const key of ['title', 'synopsis', 'global_summary', 'style_note', 'style_profile', 'style_profile_at'] as const) {
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
    outline: '',
    summary: '',
    summary_brief: '',
    summary_micro: '',
    summary_locked: 0,
    summarized_len: 0,
    created_at: t,
    updated_at: t,
  }
  stmt.insertChapter.run(
    ch.id, ch.project_id, ch.sort_order, ch.title, ch.content, ch.outline, ch.summary,
    ch.summary_locked, ch.summarized_len, ch.created_at, ch.updated_at,
  )
  stmt.touchProject.run(t, projectId)
  return ch
}

const CHAPTER_PATCH_FIELDS = [
  'title', 'content', 'outline', 'summary', 'summary_brief', 'summary_micro',
  'summary_locked', 'sort_order', 'summarized_len',
] as const

export interface ChapterPatch {
  title?: string
  content?: string
  outline?: string
  summary?: string
  summary_brief?: string
  summary_micro?: string
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

// ---------- 上下文设置（用户手动挑选） ----------

export interface ContextSettings {
  disabledBlocks: string[]
  excludedChapters: string[]
  pinnedChapters: string[]
  /** 远段合段：每几章压缩成一段 */
  groupSize: number
  /** 结构图里手动锁定「用这一层」的节点 key（如 L2:7） */
  lockedNodes: string[]
}

/** 远段合段的默认章数 */
export const DEFAULT_GROUP_SIZE = 3
export const GROUP_SIZE_OPTIONS = [2, 3, 4, 5, 8] as const

export function clampGroupSize(v: unknown): number {
  const n = typeof v === 'number' ? Math.round(v) : Number(v)
  if (!Number.isFinite(n)) return DEFAULT_GROUP_SIZE
  return Math.min(10, Math.max(2, n))
}

export interface SegmentRow {
  project_id: string
  size: number
  start_order: number
  end_order: number
  chapter_ids: string
  text: string
  source_hash: string
  updated_at: number
}

export function listSegments(projectId: string, size: number): SegmentRow[] {
  return stmt.listSegments.all(projectId, size)
}

export function upsertSegment(row: SegmentRow): void {
  stmt.upsertSegment.run(row)
}

/** 供上下文组装使用：只取起始章节序号与压缩后的文本 */
export function listSegmentTexts(projectId: string, size: number): { startOrder: number; text: string }[] {
  return listSegments(projectId, size).map((r) => ({ startOrder: r.start_order, text: r.text }))
}

export function clearSegments(projectId: string, size: number): void {
  stmt.deleteSegments.run(projectId, size)
}

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function getContextSettings(projectId: string): ContextSettings {
  const row = stmt.getContextSettings.get(projectId) as
    | {
        project_id: string
        disabled_blocks: string
        excluded_chapters: string
        pinned_chapters: string
        locked_nodes: string
        group_size: number
      }
    | undefined
  if (!row) {
    return {
      disabledBlocks: [], excludedChapters: [], pinnedChapters: [],
      groupSize: DEFAULT_GROUP_SIZE, lockedNodes: [],
    }
  }
  return {
    disabledBlocks: parseList(row.disabled_blocks),
    excludedChapters: parseList(row.excluded_chapters),
    pinnedChapters: parseList(row.pinned_chapters),
    groupSize: clampGroupSize(row.group_size),
    lockedNodes: parseList(row.locked_nodes).filter((k) => /^L\d+:\d+$/.test(k)),
  }
}

export function saveContextSettings(projectId: string, patch: Partial<ContextSettings>): ContextSettings {
  const cur = getContextSettings(projectId)
  const next: ContextSettings = {
    disabledBlocks: patch.disabledBlocks ?? cur.disabledBlocks,
    excludedChapters: patch.excludedChapters ?? cur.excludedChapters,
    pinnedChapters: patch.pinnedChapters ?? cur.pinnedChapters,
    groupSize: patch.groupSize !== undefined ? clampGroupSize(patch.groupSize) : cur.groupSize,
    lockedNodes: patch.lockedNodes ?? cur.lockedNodes,
  }
  stmt.upsertContextSettings.run(
    projectId,
    JSON.stringify(next.disabledBlocks),
    JSON.stringify(next.excludedChapters),
    JSON.stringify(next.pinnedChapters),
    JSON.stringify(next.lockedNodes),
    next.groupSize,
    now(),
  )
  return next
}

// ---------- 人物模块 ----------

export interface CharacterProfileRow {
  lore_id: string
  project_id: string
  gender: string
  age: string
  role: string
  appearance: string
  personality: string
  motivation: string
  catchphrase: string
  avatar: string
  color: string
  updated_at: number
}

export interface CharacterRelationRow {
  id: string
  project_id: string
  a_lore_id: string
  b_lore_id: string
  label: string
  updated_at: number
}

export interface CharacterStateRow {
  id: string
  lore_id: string
  chapter_id: string
  chapter_title: string
  state: string
  created_at: number
}

export interface CharacterProfilePatch {
  gender?: string
  age?: string
  role?: string
  appearance?: string
  personality?: string
  motivation?: string
  catchphrase?: string
  avatar?: string
  color?: string
}

export function getCharacterProfile(loreId: string): CharacterProfileRow | undefined {
  return stmt.getProfile.get(loreId)
}

export function listCharacterProfiles(projectId: string): CharacterProfileRow[] {
  return stmt.listProfiles.all(projectId)
}

export function upsertCharacterProfile(loreId: string, projectId: string, patch: CharacterProfilePatch): void {
  const prev = stmt.getProfile.get(loreId)
  const row: CharacterProfileRow = {
    lore_id: loreId,
    project_id: projectId,
    gender: patch.gender ?? prev?.gender ?? '',
    age: patch.age ?? prev?.age ?? '',
    role: patch.role ?? prev?.role ?? '',
    appearance: patch.appearance ?? prev?.appearance ?? '',
    personality: patch.personality ?? prev?.personality ?? '',
    motivation: patch.motivation ?? prev?.motivation ?? '',
    catchphrase: patch.catchphrase ?? prev?.catchphrase ?? '',
    avatar: patch.avatar ?? prev?.avatar ?? '',
    color: patch.color ?? prev?.color ?? '',
    updated_at: now(),
  }
  stmt.upsertProfile.run(row)
}

export function listRelations(projectId: string): CharacterRelationRow[] {
  return stmt.listRelations.all(projectId)
}

export function listRelationsFor(projectId: string, ids: string[]): CharacterRelationRow[] {
  if (ids.length === 0) return []
  const set = new Set(ids)
  return listRelations(projectId).filter((r) => set.has(r.a_lore_id) || set.has(r.b_lore_id))
}

export function createRelation(projectId: string, a: string, b: string, label: string): CharacterRelationRow {
  const row: CharacterRelationRow = {
    id: randomUUID(),
    project_id: projectId,
    a_lore_id: a,
    b_lore_id: b,
    label,
    updated_at: now(),
  }
  stmt.insertRelation.run(row)
  return row
}

export function deleteRelation(id: string): void {
  stmt.deleteRelation.run(id)
}

export function addStateHistory(loreId: string, chapterId: string, chapterTitle: string, state: string): void {
  stmt.insertStateHistory.run(randomUUID(), loreId, chapterId, chapterTitle, state, now())
}

export function listStateHistory(loreId: string): CharacterStateRow[] {
  return stmt.listStateHistory.all(loreId)
}

// ---------- 版本历史 ----------

const MAX_SNAPSHOTS_PER_CHAPTER = 30

export interface SnapshotMeta {
  id: string
  chapter_id: string
  label: string
  length: number
  created_at: number
}

export function createSnapshot(chapterId: string, content: string, label = ''): SnapshotRow {
  const row: SnapshotRow = { id: randomUUID(), chapter_id: chapterId, content, label, created_at: now() }
  stmt.insertSnapshot.run(row.id, row.chapter_id, row.content, row.label, row.created_at)
  pruneSnapshots(chapterId)
  return row
}

export function listSnapshots(chapterId: string): SnapshotMeta[] {
  return stmt.listSnapshots.all(chapterId)
}

export function getSnapshot(id: string): SnapshotRow | undefined {
  return stmt.getSnapshot.get(id)
}

export function deleteSnapshot(id: string): void {
  stmt.deleteSnapshot.run(id)
}

export function pruneSnapshots(chapterId: string): void {
  const all = stmt.snapshotIds.all(chapterId)
  for (const row of all.slice(MAX_SNAPSHOTS_PER_CHAPTER)) {
    stmt.deleteSnapshot.run(row.id)
  }
}

// ---------- 写作统计 ----------

export function todayString(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function recordStat(projectId: string, chapterId: string, delta: number): void {
  if (delta === 0) return
  stmt.insertStat.run(randomUUID(), projectId, chapterId, todayString(), delta, now())
}

export interface DayStat {
  day: string
  chars: number
}

export function listStats(projectId: string, days: number): DayStat[] {
  const rows = stmt.statsByDay.all(projectId)
  const map = new Map(rows.map((r) => [r.day, r.chars]))
  const out: DayStat[] = []
  const d = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i)
    const p = (n: number) => String(n).padStart(2, '0')
    const key = `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`
    out.push({ day: key, chars: map.get(key) ?? 0 })
  }
  return out
}

/** 连续写作天数（当天没写则从昨天往前算） */
export function writingStreak(projectId: string): number {
  const map = new Map(stmt.statsByDay.all(projectId).map((r) => [r.day, r.chars]))
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const key = (offset: number) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset)
    return `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`
  }
  let streak = 0
  let offset = (map.get(key(0)) ?? 0) > 0 ? 0 : 1
  for (let i = 0; i < 3650; i++) {
    if ((map.get(key(offset)) ?? 0) > 0) {
      streak++
      offset++
    } else break
  }
  return streak
}

// ---------- 云同步：快照导入导出 ----------

const upsertProjectStmt = db.prepare(`
  INSERT INTO projects (id, title, synopsis, global_summary, style_note, created_at, updated_at)
  VALUES (@id, @title, @synopsis, @global_summary, @style_note, @created_at, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, synopsis = excluded.synopsis,
    global_summary = excluded.global_summary, style_note = excluded.style_note,
    created_at = excluded.created_at, updated_at = excluded.updated_at
`)

const upsertChapterStmt = db.prepare(`
  INSERT INTO chapters (id, project_id, sort_order, title, content, summary, summary_locked, summarized_len, created_at, updated_at)
  VALUES (@id, @project_id, @sort_order, @title, @content, @summary, @summary_locked, @summarized_len, @created_at, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id, sort_order = excluded.sort_order, title = excluded.title,
    content = excluded.content, summary = excluded.summary, summary_locked = excluded.summary_locked,
    summarized_len = excluded.summarized_len, created_at = excluded.created_at, updated_at = excluded.updated_at
`)

const upsertLoreStmt = db.prepare(`
  INSERT INTO lore_entries (id, project_id, type, name, aliases, content, current_state, always_on, priority, enabled, updated_at)
  VALUES (@id, @project_id, @type, @name, @aliases, @content, @current_state, @always_on, @priority, @enabled, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id, type = excluded.type, name = excluded.name, aliases = excluded.aliases,
    content = excluded.content, current_state = excluded.current_state, always_on = excluded.always_on,
    priority = excluded.priority, enabled = excluded.enabled, updated_at = excluded.updated_at
`)

export function upsertProjectRow(row: ProjectRow): void {
  upsertProjectStmt.run(row)
}

export function upsertChapterRow(row: ChapterRow): void {
  upsertChapterStmt.run(row)
}

export function upsertLoreRow(row: LoreRow): void {
  upsertLoreStmt.run(row)
}

/** 清空全部项目（章节与设定随外键级联删除） */
export function deleteAllProjects(): void {
  db.prepare('DELETE FROM projects').run()
}

export function countAll(): { projects: number; chapters: number; lore: number } {
  const p = db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }
  const c = db.prepare('SELECT COUNT(*) AS n FROM chapters').get() as { n: number }
  const l = db.prepare('SELECT COUNT(*) AS n FROM lore_entries').get() as { n: number }
  return { projects: p.n, chapters: c.n, lore: l.n }
}
