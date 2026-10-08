import { z } from 'zod'
import { env } from '../env.js'
import { chatOnce, extractJson } from '../llm/client.js'
import {
  characterStatePrompt, chapterSummaryPrompt, incrementalChapterSummaryPrompt,
  mergeGlobalSummaryPrompt, rebuildGlobalSummaryPrompt,
} from '../llm/prompts.js'
import { matchLore } from '../context/lore-match.js'
import {
  getChapter, getProject, listChaptersFull, listLore, updateChapter, updateLore, updateProject,
} from '../db/repo.js'

export interface JobUpdate {
  name: string
  current_state: string
}

export interface JobInfo {
  chapterId: string
  chapterTitle: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
  updates?: JobUpdate[]
  updatedAt: number
}

/** chapterId -> 任务信息 */
const jobs = new Map<string, JobInfo>()
/** 待执行队列 */
const queue: string[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let draining = false

export function enqueueSummarize(chapterId: string, opts: { delayMs?: number } = {}): void {
  const existing = jobs.get(chapterId)
  if (existing && existing.status === 'running') return
  if (timers.has(chapterId)) return
  const ch = getChapter(chapterId)
  if (!ch) return
  const t = setTimeout(() => {
    timers.delete(chapterId)
    enqueueNow(chapterId)
  }, opts.delayMs ?? 0)
  timers.set(chapterId, t)
}

function enqueueNow(chapterId: string): void {
  const ch = getChapter(chapterId)
  if (!ch) return
  const existing = jobs.get(chapterId)
  if (existing && existing.status === 'running') return
  jobs.set(chapterId, { chapterId, chapterTitle: ch.title, status: 'pending', updatedAt: Date.now() })
  queue.push(chapterId)
  void drain()
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()
      if (!id) break
      await runJob(id)
    }
  } finally {
    draining = false
  }
}

async function runJob(chapterId: string): Promise<void> {
  const job = jobs.get(chapterId)
  if (!job) return
  job.status = 'running'
  job.updatedAt = Date.now()
  try {
    const ch = getChapter(chapterId)
    if (!ch) throw new Error('章节不存在')
    const project = getProject(ch.project_id)
    if (!project) throw new Error('项目不存在')

    // 1. 章节摘要（锁定则跳过，但仍参与梗概与人物状态更新）
    let summary = ch.summary
    let summaryUpdated = false
    if (!ch.summary_locked && ch.content.trim().length >= 100) {
      // 已有摘要且只是续写：只把新增部分发给模型，省 token 也更快
      const newPart =
        ch.summarized_len > 0 && ch.summarized_len < ch.content.length
          ? ch.content.slice(ch.summarized_len)
          : ''
      const canIncremental = ch.summary.trim().length > 0 && newPart.trim().length > 0
      const messages = canIncremental
        ? incrementalChapterSummaryPrompt(ch.summary, newPart)
        : chapterSummaryPrompt(ch.content)
      const s = await chatOnce('strong', messages, {
        maxTokens: 2000,
        temperature: 0.3,
        effort: env.strong.effort || undefined,
      })
      if (s) {
        summary = s
        summaryUpdated = true
      }
    }
    if (summaryUpdated || ch.summary_locked) {
      updateChapter(chapterId, {
        summary,
        summarized_len: ch.content.length,
      })
    }

    // 2. 全书梗概滚动合并
    if (summary.trim()) {
      const merged = await chatOnce(
        'strong',
        mergeGlobalSummaryPrompt(project.global_summary, ch.title, summary),
        { maxTokens: 2500, temperature: 0.3, effort: env.strong.effort || undefined },
      )
      if (merged) updateProject(project.id, { global_summary: merged })
    }

    // 3. 人物状态更新
    if (summary.trim()) {
      const lore = listLore(ch.project_id)
      const characters = lore.filter((l) => l.type === 'character' && l.enabled)
      // 以章节正文（截取后半，靠近结尾更相关）匹配出场人物
      const scanText = ch.content.slice(-4000)
      const hits = matchLore(
        characters.map((c) => ({
          id: c.id, name: c.name, aliases: safeParseAliases(c.aliases),
          priority: c.priority, alwaysOn: !!c.always_on, enabled: !!c.enabled,
        })),
        scanText,
        12,
      )
      const present = hits
        .map((h) => characters.find((c) => c.id === h.id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
      if (present.length > 0) {
        const raw = await chatOnce(
          'strong',
          characterStatePrompt(ch.title, summary, present.map((c) => ({
            name: c.name,
            content: c.content,
            currentState: c.current_state,
          }))),
          { maxTokens: 2000, temperature: 0.2, effort: env.strong.effort || undefined },
        )
        const parsed = StateUpdateSchema.safeParse(extractJson(raw))
        if (parsed.success) {
          const updates: JobUpdate[] = []
          for (const u of parsed.data.updates) {
            const target = present.find((c) => c.name === u.name)
            if (!target) continue
            updateLore(target.id, { current_state: u.current_state })
            updates.push({ name: u.name, current_state: u.current_state })
          }
          job.updates = updates
        }
      }
    }

    job.status = 'done'
  } catch (e) {
    job.status = 'error'
    job.error = e instanceof Error ? e.message : String(e)
  }
  job.updatedAt = Date.now()
}

const StateUpdateSchema = z.object({
  updates: z.array(z.object({
    name: z.string().min(1),
    current_state: z.string().max(500),
  })),
})

export function listJobs(): JobInfo[] {
  return [...jobs.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
}

function safeParseAliases(aliases: string): string[] {
  try {
    const v = JSON.parse(aliases)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 从全部章节摘要重建全书梗概 */
export async function rebuildGlobalSummary(projectId: string): Promise<string> {
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')
  const chapters = listChaptersFull(projectId)
  const parts = chapters.filter((c) => c.summary.trim()).map((c) => `第${c.sort_order}章《${c.title}》：${c.summary.trim()}`)
  if (parts.length === 0) throw new Error('还没有任何章节摘要，请先生成摘要')
  const text = await chatOnce('strong', rebuildGlobalSummaryPrompt(parts), { maxTokens: 2500, temperature: 0.3, effort: env.strong.effort || undefined })
  if (!text) throw new Error('模型没有返回内容')
  updateProject(projectId, { global_summary: text })
  return text
}
