import type {
  Chapter, JobInfo, LoreEntry, ProjectDetail, ProjectMeta,
  SuggestLength, SuggestMeta, SuggestMode,
} from '../types'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (j?.error?.message) message = j.error.message
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}

// ---------- 项目 ----------

export const apiListProjects = () => api<ProjectMeta[]>('/api/projects')
export const apiCreateProject = (title: string) => api<ProjectMeta>('/api/projects', { method: 'POST', body: JSON.stringify({ title }) })
export const apiGetProject = (id: string) => api<ProjectDetail>(`/api/projects/${id}`)
export const apiPatchProject = (id: string, patch: Partial<Pick<ProjectDetail['project'], 'title' | 'synopsis' | 'style_note' | 'style_profile' | 'global_summary'>>) =>
  api<ProjectDetail['project']>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const apiDeleteProject = (id: string) => api<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' })
export const apiRebuildSummary = (id: string) => api<{ global_summary: string }>(`/api/projects/${id}/rebuild-summary`, { method: 'POST' })
export const apiExportUrl = (id: string, format: 'txt' | 'md') => `/api/projects/${id}/export?format=${format}`

// ---------- 章节 ----------

export interface ChapterPatch {
  title?: string
  content?: string
  outline?: string
  summary?: string
  summary_locked?: boolean
  sort_order?: number
}

export const apiCreateChapter = (projectId: string, title: string) =>
  api<Chapter>(`/api/projects/${projectId}/chapters`, { method: 'POST', body: JSON.stringify({ title }) })
export const apiPatchChapter = (id: string, patch: ChapterPatch) =>
  api<Chapter>(`/api/chapters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const apiDeleteChapter = (id: string) => api<{ ok: boolean }>(`/api/chapters/${id}`, { method: 'DELETE' })
export const apiSummarizeChapter = (id: string) => api<{ ok: boolean; message?: string }>(`/api/chapters/${id}/summarize`, { method: 'POST' })
export const apiMaybeSummarize = (id: string) => api<{ enqueued: boolean }>(`/api/chapters/${id}/maybe-summarize`, { method: 'POST' })

// ---------- 设定 ----------

export interface LorePayload {
  type?: LoreEntry['type']
  name?: string
  aliases?: string[]
  content?: string
  current_state?: string
  always_on?: boolean
  priority?: number
  enabled?: boolean
}

export const apiCreateLore = (projectId: string, payload: LorePayload) =>
  api<LoreEntry>(`/api/projects/${projectId}/lore`, { method: 'POST', body: JSON.stringify(payload) })
export const apiPatchLore = (id: string, payload: LorePayload) =>
  api<LoreEntry>(`/api/lore/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const apiDeleteLore = (id: string) => api<{ ok: boolean }>(`/api/lore/${id}`, { method: 'DELETE' })

// ---------- 其他 ----------

export interface ModelConfigView {
  baseURL: string
  model: string
  effort: string
  apiKey: string
  configured: boolean
  source: 'env' | 'ui'
  usingUI: boolean
}

export const apiSettings = () => api<{ fast: ModelConfigView; strong: ModelConfigView }>('/api/settings')
export const apiSaveSettings = (body: {
  fast?: { baseURL?: string; apiKey?: string; model?: string; effort?: string }
  strong?: { baseURL?: string; apiKey?: string; model?: string; effort?: string }
}) => api<{ ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(body) })
export const apiResetSettings = (kind?: 'fast' | 'strong') =>
  api<{ ok: boolean }>('/api/settings/reset', { method: 'POST', body: JSON.stringify(kind ? { kind } : {}) })
export const apiTestSettings = (kind: 'fast' | 'strong') =>
  api<{ ok: boolean; message: string; latencyMs?: number }>('/api/settings/test', {
    method: 'POST',
    body: JSON.stringify({ kind }),
  })
export const apiListModels = (kind: 'fast' | 'strong') =>
  api<{ ok: boolean; models: string[]; message: string }>('/api/settings/models', {
    method: 'POST',
    body: JSON.stringify({ kind }),
  })
export const apiJobs = () => api<JobInfo[]>('/api/jobs')

// ---------- 上下文链条 ----------

export interface ContextSettings {
  disabledBlocks: string[]
  excludedChapters: string[]
  pinnedChapters: string[]
  /** 远段合段：每几章压缩成一段 */
  groupSize: number
}

export interface ContextBlock {
  key: string
  label: string
  chars: number
  enabled: boolean
}

export interface ContextChainSegment {
  startOrder: number
  endOrder: number
  chapterIds: string[]
  /** llm = 模型压缩好的合段摘要；joined = 用各章极简摘要拼接 */
  source: 'llm' | 'joined'
}

export interface ContextChainEntry {
  chapterId: string
  title: string
  order: number
  distance: number
  tier: 'full' | 'brief' | 'micro'
  text: string
  chars: number
  pinned: boolean
  included: boolean
  reason?: string
  /** 远段合段条目：覆盖多章 */
  segment?: ContextChainSegment
}

export const apiContextSettings = (projectId: string) =>
  api<{ settings: ContextSettings }>(`/api/projects/${projectId}/context-settings`)
export const apiSaveContextSettings = (projectId: string, patch: Partial<ContextSettings>) =>
  api<{ settings: ContextSettings }>(`/api/projects/${projectId}/context-settings`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
export const apiContextPreview = (projectId: string, chapterId?: string) =>
  api<{
    settings: ContextSettings
    blocks: ContextBlock[]
    chain: ContextChainEntry[]
    totalChars: number
    activeChapterId: string
  }>(`/api/projects/${projectId}/context-preview${chapterId ? `?chapterId=${chapterId}` : ''}`)
export const apiChapterSummaries = (chapterId: string) =>
  api<{ summary: string; brief: string; micro: string; locked: boolean }>(`/api/chapters/${chapterId}/summaries`)
export const apiRefreshSegments = (projectId: string) =>
  api<{ ok: boolean; size: number; total: number; generated: number; skipped: number; failed: number }>(
    `/api/projects/${projectId}/segments/refresh`,
    { method: 'POST' },
  )

// ---------- 人物模块 ----------

export interface CharacterProfile {
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

export interface CharacterItem extends LoreEntry {
  profile: CharacterProfile | null
}

export interface CharacterRelation {
  id: string
  project_id: string
  a_lore_id: string
  b_lore_id: string
  label: string
  updated_at: number
}

export interface AppearanceInfo {
  total: number
  chapters: { chapterId: string; title: string; sortOrder: number; count: number }[]
}

export interface StateHistoryItem {
  id: string
  lore_id: string
  chapter_id: string
  chapter_title: string
  state: string
  created_at: number
}

export const apiCharacters = (projectId: string) =>
  api<{ characters: CharacterItem[]; relations: CharacterRelation[] }>(`/api/projects/${projectId}/characters`)
export const apiPatchProfile = (loreId: string, patch: Partial<Omit<CharacterProfile, 'lore_id' | 'project_id' | 'updated_at'>>) =>
  api<CharacterProfile>(`/api/characters/${loreId}/profile`, { method: 'PATCH', body: JSON.stringify(patch) })
export const apiAppearances = (loreId: string) => api<AppearanceInfo>(`/api/characters/${loreId}/appearances`)
export const apiStateHistory = (loreId: string) => api<StateHistoryItem[]>(`/api/characters/${loreId}/history`)
export const apiAddStateHistory = (loreId: string, state: string) =>
  api<StateHistoryItem[]>(`/api/characters/${loreId}/history`, { method: 'POST', body: JSON.stringify({ state }) })
export const apiCreateRelation = (projectId: string, a: string, b: string, label: string) =>
  api<CharacterRelation>(`/api/projects/${projectId}/relations`, { method: 'POST', body: JSON.stringify({ a, b, label }) })
export const apiDeleteRelation = (id: string) => api<{ ok: boolean }>(`/api/relations/${id}`, { method: 'DELETE' })
export const apiDetectCharacters = (projectId: string) =>
  api<{ ok: boolean; created: string[]; sampleChars: number }>(`/api/projects/${projectId}/characters/detect`, { method: 'POST' })
export const apiFillCharacter = (loreId: string) =>
  api<{ ok: boolean; profile: CharacterProfile; sampleChars: number }>(`/api/characters/${loreId}/fill`, { method: 'POST' })
export const apiInferRelations = (loreId: string) =>
  api<{ ok: boolean; added: string[] }>(`/api/characters/${loreId}/infer-relations`, { method: 'POST' })

// ---------- 统计 / 历史 / 搜索 / 导入 ----------

export interface StyleProfile {
  perspective: string
  sentence: string
  wording: string
  dialogue: string
  rhetoric: string
  avoid: string
  note: string
}

export const apiAnalyzeStyle = (projectId: string) =>
  api<{ ok: boolean; profile: StyleProfile; sampleChars: number }>(`/api/projects/${projectId}/analyze-style`, { method: 'POST' })

export interface StatsResult {
  today: number
  streak: number
  daily: { day: string; chars: number }[]
  chapters: { id: string; title: string; chars: number }[]
  total: number
}

export interface SnapshotMeta {
  id: string
  chapter_id: string
  label: string
  length: number
  created_at: number
}

export interface SearchMatch {
  chapterId: string
  title: string
  index: number
  preview: string
}

export const apiStats = (projectId: string, days = 30) => api<StatsResult>(`/api/projects/${projectId}/stats?days=${days}`)
export const apiSnapshots = (chapterId: string) => api<SnapshotMeta[]>(`/api/chapters/${chapterId}/snapshots`)
export const apiCreateSnapshot = (chapterId: string, label?: string) =>
  api<{ ok: boolean; snapshots: SnapshotMeta[] }>(`/api/chapters/${chapterId}/snapshots`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  })
export const apiRestoreSnapshot = (id: string) =>
  api<{ ok: boolean; chapter: Chapter }>(`/api/snapshots/${id}/restore`, { method: 'POST' })
export const apiSnapshotContent = (id: string) =>
  api<{ id: string; chapter_id: string; content: string; label: string; created_at: number }>(`/api/snapshots/${id}`)
export const apiSearch = (projectId: string, q: string) =>
  api<{ query: string; matches: SearchMatch[]; total: number }>(`/api/projects/${projectId}/search?q=${encodeURIComponent(q)}`)
export const apiReplace = (projectId: string, body: { query: string; replacement: string; chapterIds?: string[] }) =>
  api<{ ok: boolean; chapters: number; replacements: number }>(`/api/projects/${projectId}/replace`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const apiImport = (projectId: string, body: { text: string; mode: 'md-heading' | 'chapter-regex' | 'single'; defaultTitle?: string }) =>
  api<{ ok: boolean; chapters: number; titles: string[] }>(`/api/projects/${projectId}/import`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

// ---------- 云同步 ----------

export type SyncProviderType = 'local' | 's3' | 'webdav' | 'gist'

export interface SyncProviderForm {
  type: SyncProviderType
  dir?: string
  endpoint?: string
  region?: string
  bucket?: string
  key?: string
  accessKeyId?: string
  secretAccessKey?: string
  url?: string
  username?: string
  password?: string
  token?: string
  gistId?: string
}

export interface SyncConfigResponse {
  provider: SyncProviderForm | null
  autoSync: boolean
  autoSyncMinutes: number
  lastPushAt: number | null
  lastPullAt: number | null
  local: { projects: number; chapters: number; lore: number }
}

export interface SyncRemoteInfo {
  exists: boolean
  savedAt?: number
  bytes?: number
  chapters?: number
  projects?: { title: string; chapters: number }[]
}

export const apiSyncConfig = () => api<SyncConfigResponse>('/api/sync/config')
export const apiSyncSave = (body: { provider?: SyncProviderForm | null; autoSync?: boolean; autoSyncMinutes?: number }) =>
  api<SyncConfigResponse>('/api/sync/config', { method: 'PUT', body: JSON.stringify(body) })
export const apiSyncTest = (body: { provider?: SyncProviderForm | null }) =>
  api<{ ok: boolean; message: string }>('/api/sync/test', { method: 'POST', body: JSON.stringify(body) })
export const apiSyncPush = () =>
  api<{ ok: boolean; savedAt: number; bytes: number; projects: number; lastPushAt: number | null }>('/api/sync/push', { method: 'POST' })
export const apiSyncRemote = () => api<SyncRemoteInfo>('/api/sync/remote')
export const apiSyncPull = (mode: 'merge' | 'replace') =>
  api<{ ok: boolean; mode: string; savedAt: number; counts: { projects: number; chapters: number; lore: number }; lastPullAt: number | null }>(
    '/api/sync/pull',
    { method: 'POST', body: JSON.stringify({ mode }) },
  )

export interface SuggestFeedback {
  projectId: string
  chapterId: string
  outcome: 'accepted' | 'partial' | 'dismissed'
  latencyMs?: number
}

export const apiFeedback = (body: SuggestFeedback) =>
  api<{ ok: boolean }>('/api/suggest/feedback', { method: 'POST', body: JSON.stringify(body) })

// ---------- 提词 SSE ----------

export interface SuggestStreamHandlers {
  onMeta?: (meta: SuggestMeta) => void
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

/** POST /api/suggest 并解析 SSE 流 */
export async function streamSuggest(
  body: {
    projectId: string
    chapterId: string
    prefix: string
    suffix: string
    mode: SuggestMode
    length?: SuggestLength
    /** 换一个候选：提高随机度 */
    alt?: boolean
  },
  handlers: SuggestStreamHandlers,
): Promise<void> {
  const res = await fetch('/api/suggest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (j?.error?.message) message = j.error.message
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const { event, data } = parseSseBlock(raw)
      if (!event && !data) continue
      if (event === 'meta') handlers.onMeta?.(JSON.parse(data) as SuggestMeta)
      else if (event === 'delta') handlers.onDelta?.((JSON.parse(data) as { text: string }).text)
      else if (event === 'error') throw new Error((JSON.parse(data) as { message: string }).message || '模型请求失败')
      else if (event === 'done') return
    }
  }
}

function parseSseBlock(raw: string): { event: string; data: string } {
  let event = ''
  let data = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim()
  }
  return { event, data }
}
