import { Hono } from 'hono'
import { z } from 'zod'
import {
  createChapter, createSnapshot, getChapter, getProject, getSnapshot, listChapterMetas,
  listChaptersFull, listSnapshots, listStats, recordStat, todayString, updateChapter, updateProject,
  writingStreak,
  type ChapterRow,
} from '../db/repo.js'
import { searchChapters, replaceInText } from '../services/search.js'
import { parseImport } from '../services/import.js'
import { analyzeStylePrompt } from '../llm/prompts.js'
import { chatOnceRobust, extractJson } from '../llm/client.js'
import { env } from '../env.js'
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

// ---------- 文风自动总结 ----------

const STYLE_SAMPLE_CHARS = 8000
const STYLE_MIN_CHARS = 300

const StyleProfileSchema = z.object({
  perspective: z.string().max(200).optional().default(''),
  sentence: z.string().max(300).optional().default(''),
  wording: z.string().max(300).optional().default(''),
  dialogue: z.string().max(300).optional().default(''),
  rhetoric: z.string().max(300).optional().default(''),
  avoid: z.string().max(300).optional().default(''),
  note: z.string().max(1000).optional().default(''),
})

toolsRoute.post('/projects/:id/analyze-style', async (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) notFound('项目不存在')

  // 取最近正文作为样本（从最新章节往前取，够 8000 字为止）
  const chapters = [...listChaptersFull(id)].sort((a, b) => b.sort_order - a.sort_order)
  let sample = ''
  for (const ch of chapters) {
    sample = ch.content.slice(-STYLE_SAMPLE_CHARS) + sample
    if (sample.length >= STYLE_SAMPLE_CHARS) break
  }
  sample = sample.slice(-STYLE_SAMPLE_CHARS)

  const totalChars = chapters.reduce((s, ch) => s + ch.content.length, 0)
  if (sample.trim().length < STYLE_MIN_CHARS) {
    badRequest(`正文太少（当前 ${totalChars} 字），至少需要 ${STYLE_MIN_CHARS} 字才能总结文风`)
  }

  // 样本较长时模型需要更多预算（实测 1500 会思考耗尽返回空）
  const raw = await chatOnceRobust('strong', analyzeStylePrompt(sample), {
    maxTokens: 3000,
    temperature: 0.3,
    effort: env.strong.effort || undefined,
  })
  // 文风分析为纯文本输出；若模型返回 JSON 也能兼容
  // 注意：extractJson 对纯文本返回 null，此时不能拿 {} 去校验（空对象会通过校验并覆盖真实内容）
  const json = extractJson(raw)
  const parsed = json ? StyleProfileSchema.safeParse(json) : null
  const hasProfileContent = (p: z.infer<typeof StyleProfileSchema>) =>
    p.note.trim().length > 0 ||
    ['perspective', 'sentence', 'wording', 'dialogue', 'rhetoric', 'avoid'].some((k) => (p[k as keyof typeof p] as string)?.trim())
  const profile =
    parsed?.success && hasProfileContent(parsed.data)
      ? parsed.data
      : { perspective: '', sentence: '', wording: '', dialogue: '', rhetoric: '', avoid: '', note: raw.trim() }
  const note0 = profile.note.trim()
  const hasFields = ['perspective', 'sentence', 'wording', 'dialogue', 'rhetoric', 'avoid'].some(
    (k) => (profile[k as keyof typeof profile] as string)?.trim(),
  )
  if (!note0 && !hasFields && !raw.trim()) badRequest('模型没有返回可用的文风结果，请稍后重试')

  const note =
    profile.note.trim() ||
    [
      profile.perspective && `视角：${profile.perspective}`,
      profile.sentence && `句式：${profile.sentence}`,
      profile.wording && `用词：${profile.wording}`,
      profile.dialogue && `对话：${profile.dialogue}`,
      profile.rhetoric && `意象：${profile.rhetoric}`,
      profile.avoid && `避免：${profile.avoid}`,
    ]
      .filter(Boolean)
      .join('；')

  if (!note.trim()) badRequest('模型没有返回风格指令，请重试')

  updateProject(id, { style_profile: note, style_profile_at: Date.now() })
  return c.json({ ok: true, profile: { ...profile, note }, sampleChars: sample.length })
})

// ---------- 版本历史 ----------

toolsRoute.get('/chapters/:id/snapshots', (c) => {
  const id = c.req.param('id')
  if (!getChapter(id)) notFound('章节不存在')
  return c.json(listSnapshots(id))
})

/** 查看某个版本的内容（恢复前预览） */
toolsRoute.get('/snapshots/:id', (c) => {
  const id = c.req.param('id')
  const snap = getSnapshot(id)
  if (!snap) notFound('版本不存在')
  return c.json(snap)
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
  // 恢复不计入写作统计（统计只反映真实写作量）
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
