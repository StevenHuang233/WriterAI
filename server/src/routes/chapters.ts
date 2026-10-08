import { Hono } from 'hono'
import { z } from 'zod'
import {
  createChapter, createSnapshot, deleteChapter, getChapter, getProject,
  listSnapshots, recordStat, updateChapter,
} from '../db/repo.js'
import { enqueueSummarize } from '../jobs/summarizer.js'
import { markDirty } from '../jobs/autoSync.js'
import { badRequest, notFound, parseBody } from './util.js'

export const chaptersRoute = new Hono()

/** 自动摘要：正文自上次摘要后增长超过该值时，延迟触发 */
const AUTO_SUMMARY_GROWTH = 1500
/** 切换章节：正文长度与上次摘要时相差超过该值时触发 */
const SWITCH_SUMMARY_DELTA = 300

const CreateSchema = z.object({ title: z.string().trim().min(1).max(200) })

/** 自动留版本的间隔与字数阈值 */
const AUTO_SNAPSHOT_MS = 5 * 60_000
const AUTO_SNAPSHOT_CHARS = 500

function maybeSnapshot(chapterId: string, oldContent: string, newContent: string): void {
  const snaps = listSnapshots(chapterId)
  const latest = snaps[0]
  if (!latest) {
    // 首个版本不存空内容：否则用户误恢复到“初始版本”会丢失全部正文
    if (oldContent.trim().length > 0) createSnapshot(chapterId, oldContent, '初始版本')
    return
  }
  const timeDue = Date.now() - latest.created_at >= AUTO_SNAPSHOT_MS
  const sizeDue = Math.abs(newContent.length - latest.length) >= AUTO_SNAPSHOT_CHARS
  if (timeDue || sizeDue) createSnapshot(chapterId, newContent, '自动保存')
}

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(200_000).optional(),
  outline: z.string().max(10_000).optional(),
  summary: z.string().max(5000).optional(),
  summary_locked: z.boolean().optional(),
  sort_order: z.number().int().min(1).max(10000).optional(),
})

chaptersRoute.get('/chapters/:id', (c) => {
  const id = c.req.param('id')
  const ch = getChapter(id)
  if (!ch) notFound('章节不存在')
  return c.json(ch)
})

chaptersRoute.post('/projects/:projectId/chapters', async (c) => {
  const projectId = c.req.param('projectId')
  if (!getProject(projectId)) notFound('项目不存在')
  const body = await parseBody(c, CreateSchema)
  return c.json(createChapter(projectId, body.title), 201)
})

chaptersRoute.patch('/chapters/:id', async (c) => {
  const id = c.req.param('id')
  const ch = getChapter(id)
  if (!ch) notFound('章节不存在')
  const body = await parseBody(c, PatchSchema)

  const patch: Parameters<typeof updateChapter>[1] = {}
  if (body.title !== undefined) patch.title = body.title
  if (body.content !== undefined) patch.content = body.content
  if (body.outline !== undefined) patch.outline = body.outline
  if (body.summary !== undefined) patch.summary = body.summary
  if (body.summary_locked !== undefined) patch.summary_locked = body.summary_locked ? 1 : 0
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order

  // 手改摘要：视为作者接管，自动锁定
  if (body.summary !== undefined && body.summary_locked === undefined && body.summary !== ch.summary) {
    patch.summary_locked = 1
    patch.summarized_len = (body.content ?? ch.content).length
  }

  // 正文变化：记录字数、按需自动留版本
  if (body.content !== undefined && body.content !== ch.content) {
    recordStat(ch.project_id, id, body.content.length - ch.content.length)
    maybeSnapshot(id, ch.content, body.content)
    markDirty()
  }

  updateChapter(id, patch)

  // 自动摘要检查（保存正文 60s 后且期间没有再次排队时执行）
  const content = body.content ?? ch.content
  if (content.length - ch.summarized_len >= AUTO_SUMMARY_GROWTH) {
    enqueueSummarize(id, { delayMs: 60_000 })
  }
  return c.json(getChapter(id))
})

chaptersRoute.delete('/chapters/:id', (c) => {
  const id = c.req.param('id')
  if (!getChapter(id)) notFound('章节不存在')
  deleteChapter(id)
  return c.json({ ok: true })
})

/** 立即摘要（手动，不受增长条件限制） */
chaptersRoute.post('/chapters/:id/summarize', (c) => {
  const id = c.req.param('id')
  const ch = getChapter(id)
  if (!ch) notFound('章节不存在')
  if (ch.content.trim().length < 100) badRequest('正文太短（至少 100 字），无法生成有意义的摘要')
  enqueueSummarize(id, { delayMs: 0 })
  return c.json({ ok: true, message: '已加入摘要队列' })
})

/** 切换离开章节时触发的条件摘要 */
chaptersRoute.post('/chapters/:id/maybe-summarize', (c) => {
  const id = c.req.param('id')
  const ch = getChapter(id)
  if (!ch) notFound('章节不存在')
  if (Math.abs(ch.content.length - ch.summarized_len) >= SWITCH_SUMMARY_DELTA) {
    enqueueSummarize(id, { delayMs: 0 })
    return c.json({ enqueued: true })
  }
  return c.json({ enqueued: false })
})
