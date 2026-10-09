import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { env, llmReady } from '../env.js'
import { createChatStream } from '../llm/client.js'
import { buildSuggestMessages } from '../context/builder.js'
import {
  getChapter, getContextSettings, getProject, listChapterMetas, listLore,
  listRelationsFor, listSegmentTexts, logSuggestion,
} from '../db/repo.js'
import { safeParseAliases } from './lore.js'
import { notFound, parseBody } from './util.js'

export const suggestRoute = new Hono()

/** 本次出场人物之间的关系，拼成「甲 — 乙：关系」 */
function relationLines(projectId: string, loreIds: string[]): string[] {
  if (loreIds.length === 0) return []
  const characters = listLore(projectId).filter((l) => l.type === 'character')
  const idToName = new Map(characters.map((c) => [c.id, c.name]))
  const set = new Set(loreIds.filter((id) => idToName.has(id)))
  if (set.size === 0) return []
  return listRelationsFor(projectId, [...set])
    .map((r) => {
      const a = idToName.get(r.a_lore_id)
      const b = idToName.get(r.b_lore_id)
      if (!a || !b) return ''
      return `${a} — ${b}：${r.label}`
    })
    .filter(Boolean)
}

const SuggestSchema = z.object({
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  prefix: z.string().max(6000),
  suffix: z.string().max(2000),
  mode: z.enum(['inline', 'continue']),
  length: z.enum(['short', 'medium', 'long']).optional(),
  /** 换一个候选：提高随机度以获得不同结果 */
  alt: z.boolean().optional(),
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
  const contextSettings = getContextSettings(body.projectId)
  const segments = listSegmentTexts(body.projectId, contextSettings.groupSize)

  const buildInput = {
    project: {
      synopsis: project.synopsis,
      globalSummary: project.global_summary,
      styleNote: project.style_note,
      styleProfile: project.style_profile,
    },
    chapters: chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      summary: ch.summary,
      summaryBrief: ch.summary_brief,
      summaryMicro: ch.summary_micro,
      sortOrder: ch.sort_order,
    })),
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
    length: body.length ?? 'medium',
    outline: chapter.outline,
    contextSettings,
    segments,
  }

  // 先构建一次拿到本次出场人物，再把他们的关系加入上下文重建
  const builtBase = buildSuggestMessages(buildInput)
  const relations = relationLines(body.projectId, builtBase.usedLoreIds)
  const built = relations.length > 0 ? buildSuggestMessages({ ...buildInput, relations }) : builtBase

  // 推理模型的思考 token 会占用输出预算，因此按期望长度给不同的 max_tokens
  const length = body.length ?? 'medium'
  const inlineTokens = { short: 400, medium: 600, long: 900 } as const
  const continueTokens = { short: 1000, medium: 2000, long: 3000 } as const
  const temperature = body.alt ? 1.05 : 0.8
  const chatOpts =
    body.mode === 'inline'
      ? { temperature, maxTokens: inlineTokens[length], stop: ['\n\n'] as string[] }
      : { temperature, maxTokens: continueTokens[length] }

  return streamSSE(c, async (stream) => {
    // 注意：不能把 AbortSignal 传给 openai SDK（在 streamSSE 回调内会导致流静默为空），
    // 改用 SDK 流对象自带的 controller 实现客户端断开时中断上游。
    let upstream: { controller: AbortController } | null = null
    let aborted = false
    stream.onAbort(() => {
      aborted = true
      upstream?.controller.abort()
    })

    await stream.writeSSE({
      event: 'meta',
      data: JSON.stringify({
        usedLoreNames: built.usedLoreNames,
        contextChars: built.totalChars,
        blocks: built.blocks,
        chain: built.chain,
        model: env[kind].model,
      }),
    })

    let full = ''
    try {
      // 推理模型的思考长度有波动，偶尔会把 token 预算耗尽导致正文为空：
      // 空结果时用更大的预算重试一次（此时还没有 delta 写出，重试是干净的）
      for (let attempt = 0; attempt < 2 && !full.trim(); attempt++) {
        const opts = attempt === 0 ? chatOpts : { ...chatOpts, maxTokens: Math.max(chatOpts.maxTokens, 1500) }
        const s = await createChatStream(kind, built.messages, {
          ...opts,
          effort: env[kind].effort || undefined,
        })
        upstream = s
        for await (const chunk of s) {
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) })
          }
        }
      }
      await stream.writeSSE({ event: 'done', data: '{}' })
    } catch (e) {
      if (aborted) return
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
