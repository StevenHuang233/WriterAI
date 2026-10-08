import { Hono } from 'hono'
import { z } from 'zod'
import {
  createChapter, createSnapshot, getChapter, getProject, getSnapshot, listChapterMetas,
  listChaptersFull, listSnapshots, listStats, recordStat, todayString, updateChapter, writingStreak,
  type ChapterRow,
} from '../db/repo.js'
import { searchChapters, replaceInText } from '../services/search.js'
import { parseImport } from '../services/import.js'
import { badRequest, notFound, parseBody } from './util.js'

export const toolsRoute = new Hono()

// ---------- 写作统计 ----------

toolsRoute.get('/projects/:id/stats', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? 30)))
  const daily = listStats(id, days)
  const chapters = listChapterMetas(id).map((ch) => ({
    id: ch.id,
    title: ch.title,
    chars: ch.content_length,
  }))
  const today = todayString()
  return c.json({
    today: daily.find((d) => d.day === today)?.chars ?? 0,
    streak: writingStreak(id),
    daily,
    chapters,
    total: chapters.reduce((s, ch) => s + ch.chars, 0),
  })
})

// ---------- 版本历史 ----------

toolsRoute.get('/chapters/:id/snapshots', (c) => {
  const id = c.req.param('id')
  if (!getChapter(id)) notFound('章节不存在')
  return c.json(listSnapshots(id))
})

toolsRoute.post('/chapters/:id/snapshots', async (c) => {
  const id = c.req.param('id')
  const ch = getChapter(id)
  if (!ch) notFound('章节不存在')
  const body = await parseBody(c, z.object({ label: z.string().max(100).optional() }))
  createSnapshot(id, ch.content, body.label ?? '手动保存')
  return c.json({ ok: true, snapshots: listSnapshots(id) }, 201)
})

toolsRoute.post('/snapshots/:id/restore', (c) => {
  const id = c.req.param('id')
  const snap = getSnapshot(id)
  if (!snap) notFound('版本不存在')
  const ch = getChapter(snap.chapter_id)
  if (!ch) notFound('章节不存在')
  // 恢复前先给当前内容留一个版本，防止再次丢失
  createSnapshot(ch.id, ch.content, '恢复前自动保存')
  updateChapter(ch.id, { content: snap.content })
  recordStat(ch.project_id, ch.id, snap.content.length - ch.content.length)
  return c.json({ ok: true, chapter: getChapter(ch.id) })
})

// ---------- 搜索 / 替换 ----------

toolsRoute.get('/projects/:id/search', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const q = (c.req.query('q') ?? '').slice(0, 200)
  if (!q) badRequest('请输入搜索内容')
  const { matches, total } = searchChapters(listChaptersFull(id), q)
  return c.json({ query: q, matches, total })
})

const ReplaceSchema = z.object({
  query: z.string().min(1).max(200),
  replacement: z.string().max(200),
  chapterIds: z.array(z.string().min(1).max(100)).max(500).optional(),
})

toolsRoute.post('/projects/:id/replace', async (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const body = await parseBody(c, ReplaceSchema)
  const scope = body.chapterIds?.length
    ? listChaptersFull(id).filter((ch) => body.chapterIds!.includes(ch.id))
    : listChaptersFull(id)
  let changed = 0
  let count = 0
  for (const ch of scope) {
    const r = replaceInText(ch.content, body.query, body.replacement)
    if (r.count === 0) continue
    // 替换前留版本，便于回退
    createSnapshot(ch.id, ch.content, '替换前自动保存')
    updateChapter(ch.id, { content: r.text })
    recordStat(id, ch.id, r.text.length - ch.content.length)
    changed++
    count += r.count
  }
  return c.json({ ok: true, chapters: changed, replacements: count })
})

// ---------- 导入 ----------

const ImportSchema = z.object({
  text: z.string().min(1).max(1_000_000),
  mode: z.enum(['md-heading', 'chapter-regex', 'single']),
  defaultTitle: z.string().max(200).optional(),
})

toolsRoute.post('/projects/:id/import', async (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const body = await parseBody(c, ImportSchema)
  const parsed = parseImport(body.text, body.mode, body.defaultTitle ?? '导入章节')
  if (parsed.length === 0) badRequest('没有解析出任何内容')
  for (const item of parsed) {
    const ch: ChapterRow = createChapter(id, item.title)
    updateChapter(ch.id, { content: item.content })
  }
  return c.json({ ok: true, chapters: parsed.length, titles: parsed.map((p) => p.title) }, 201)
})
