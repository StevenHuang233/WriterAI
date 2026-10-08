import type {
  Chapter, JobInfo, LoreEntry, ProjectDetail, ProjectMeta, SettingsInfo,
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
export const apiPatchProject = (id: string, patch: Partial<Pick<ProjectDetail['project'], 'title' | 'synopsis' | 'style_note' | 'global_summary'>>) =>
  api<ProjectDetail['project']>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const apiDeleteProject = (id: string) => api<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' })
export const apiRebuildSummary = (id: string) => api<{ global_summary: string }>(`/api/projects/${id}/rebuild-summary`, { method: 'POST' })
export const apiExportUrl = (id: string, format: 'txt' | 'md') => `/api/projects/${id}/export?format=${format}`

// ---------- 章节 ----------

export interface ChapterPatch {
  title?: string
  content?: string
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

export const apiSettings = () => api<SettingsInfo>('/api/settings')
export const apiJobs = () => api<JobInfo[]>('/api/jobs')

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
