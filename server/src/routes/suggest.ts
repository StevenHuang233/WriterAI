import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { env, llmReady } from '../env.js'
import { streamChat } from '../llm/client.js'
import { buildSuggestMessages } from '../context/builder.js'
import { getChapter, getProject, listChapterMetas, listLore, logSuggestion } from '../db/repo.js'
import { safeParseAliases } from './lore.js'
import { notFound, parseBody } from './util.js'

export const suggestRoute = new Hono()

const SuggestSchema = z.object({
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  prefix: z.string().max(6000),
  suffix: z.string().max(2000),
  mode: z.enum(['inline', 'continue']),
})

const FeedbackSchema = z.object({
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  outcome: z.enum(['accepted', 'partial', 'dismissed']),
  latencyMs: z.number().int().min(0).max(600_000).optional(),
})

suggestRoute.post('/suggest', async (c) => {
  const body = await parseBody(c, SuggestSchema)

  const project = getProject(body.projectId)
  if (!project) notFound('项目不存在')
  const chapter = getChapter(body.chapterId)
  if (!chapter || chapter.project_id !== body.projectId) notFound('章节不存在')

  const kind = body.mode === 'inline' ? 'fast' : 'strong'
  if (!llmReady(kind)) {
    throw new Error(`${kind === 'fast' ? '快速' : '强'}模型未配置，请在 .env 中设置 ${kind === 'fast' ? 'FAST' : 'STRONG'}_BASE_URL / _API_KEY / _MODEL`)
  }

  const chapters = listChapterMetas(body.projectId)
  const lore = listLore(body.projectId)

  const built = buildSuggestMessages({
    project: {
      synopsis: project.synopsis,
      globalSummary: project.global_summary,
      styleNote: project.style_note,
    },
    chapters: chapters.map((ch) => ({ id: ch.id, title: ch.title, summary: ch.summary })),
    currentChapterId: body.chapterId,
    lore: lore
      .filter((l) => !!l.enabled)
      .map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name,
        aliases: safeParseAliases(l.aliases),
        content: l.content,
        currentState: l.current_state,
        priority: l.priority,
        alwaysOn: !!l.always_on,
        enabled: !!l.enabled,
      })),
    prefix: body.prefix,
    suffix: body.suffix,
    mode: body.mode,
  })

  const chatOpts =
    body.mode === 'inline'
      ? { temperature: 0.8, maxTokens: 120, stop: ['\n\n'] as string[] }
      : { temperature: 0.8, maxTokens: 1000 }

  const ac = new AbortController()

  return streamSSE(c, async (stream) => {
    stream.onAbort(() => ac.abort())
    await stream.writeSSE({
      event: 'meta',
      data: JSON.stringify({
        usedLoreNames: built.usedLoreNames,
        contextChars: built.totalChars,
        model: env[kind].model,
      }),
    })
    let full = ''
    try {
      for await (const delta of streamChat(kind, built.messages, { ...chatOpts, signal: ac.signal })) {
        full += delta
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) })
      }
      await stream.writeSSE({ event: 'done', data: '{}' })
    } catch (e) {
      if (ac.signal.aborted) return
      const message = e instanceof Error ? e.message : String(e)
      try {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) })
      } catch {
        // 客户端已断开
      }
    }
  })
})

suggestRoute.post('/suggest/feedback', async (c) => {
  const body = await parseBody(c, FeedbackSchema)
  if (!getProject(body.projectId)) notFound('项目不存在')
  logSuggestion(body.projectId, body.chapterId, body.outcome, body.latencyMs)
  return c.json({ ok: true })
})
