import { Hono } from 'hono'
import { z } from 'zod'
import { buildSuggestMessages, BLOCK_LABELS, DEFAULT_TIER_RULES } from '../context/builder.js'
import { buildContextTree } from '../context/tree.js'
import {
  getChapter, getContextSettings, getProject, listChapterMetas, listLore, listRelationsFor,
  listSegmentTexts, saveContextSettings,
} from '../db/repo.js'
import { refreshSegments } from '../jobs/segmenter.js'
import { notFound, parseBody } from './util.js'

export const contextRoute = new Hono()

const SettingsSchema = z.object({
  disabledBlocks: z.array(z.string().max(50)).max(50).optional(),
  excludedChapters: z.array(z.string().max(100)).max(1000).optional(),
  pinnedChapters: z.array(z.string().max(100)).max(200).optional(),
  groupSize: z.number().int().min(2).max(10).optional(),
  lockedNodes: z.array(z.string().max(40).regex(/^L\d+:\d+$/)).max(200).optional(),
})

/** 当前上下文选择 */
contextRoute.get('/projects/:id/context-settings', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const settings = getContextSettings(id)
  return c.json({
    settings,
    tierRules: DEFAULT_TIER_RULES,
    blockLabels: BLOCK_LABELS,
    segments: listSegmentTexts(id, settings.groupSize).length,
  })
})

/** 重新压缩远段合段摘要 */
contextRoute.post('/projects/:id/segments/refresh', async (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const r = await refreshSegments(id, { force: true })
  return c.json({ ok: true, ...r })
})

/** 保存上下文选择 */
contextRoute.put('/projects/:id/context-settings', async (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const body = await parseBody(c, SettingsSchema)
  return c.json({ settings: saveContextSettings(id, body) })
})

/** 预览：不调用模型，只算出会放进上下文的块与历史链条 */
contextRoute.get('/projects/:id/context-preview', (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) notFound('项目不存在')

  const chapters = listChapterMetas(id)
  const activeId = c.req.query('chapterId') ?? chapters[0]?.id ?? ''
  const current = activeId ? getChapter(activeId) : undefined
  const settings = getContextSettings(id)

  const built = buildSuggestMessages({
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
    currentChapterId: activeId,
    lore: listLore(id)
      .filter((l) => !!l.enabled)
      .map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name,
        aliases: JSON.parse(l.aliases) as string[],
        content: l.content,
        currentState: l.current_state,
        priority: l.priority,
        alwaysOn: !!l.always_on,
        enabled: !!l.enabled,
      })),
    prefix: '',
    suffix: '',
    mode: 'inline',
    outline: current?.outline,
    contextSettings: settings,
    segments: listSegmentTexts(id, settings.groupSize),
  })

  return c.json({
    settings,
    tierRules: DEFAULT_TIER_RULES,
    blocks: built.blocks,
    chain: built.chain,
    totalChars: built.totalChars,
    activeChapterId: activeId,
  })
})

/** 前情结构图：叶子是每章摘要，往上是各种粒度的多章压缩，并标出当前实际用到的节点 */
contextRoute.get('/projects/:id/context-tree', (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) notFound('项目不存在')

  const chapters = listChapterMetas(id)
  const activeId = c.req.query('chapterId') ?? chapters[chapters.length - 1]?.id ?? ''
  const settings = getContextSettings(id)
  const idx = chapters.findIndex((ch) => ch.id === activeId)
  const prev = idx > 0 ? chapters.slice(0, idx) : []

  // 与提词时的预算保持一致（inline 模式的 history 预算）
  const budget = Number(c.req.query('budget') ?? '') || 1800
  const tree = buildContextTree({
    prev: prev.map((ch) => ({
      id: ch.id,
      title: ch.title,
      summary: ch.summary,
      summaryBrief: ch.summary_brief,
      summaryMicro: ch.summary_micro,
      sortOrder: ch.sort_order,
    })),
    budget,
    groupSize: settings.groupSize,
    segments: listSegmentTexts(id, settings.groupSize),
    pinned: settings.pinnedChapters,
    excluded: settings.excludedChapters,
    locked: settings.lockedNodes,
  })

  return c.json({ tree, settings, activeChapterId: activeId })
})

/** 供界面显示：某章节的三层摘要 */
contextRoute.get('/chapters/:id/summaries', (c) => {
  const ch = getChapter(c.req.param('id'))
  if (!ch) notFound('章节不存在')
  return c.json({
    summary: ch.summary,
    brief: ch.summary_brief,
    micro: ch.summary_micro,
    locked: ch.summary_locked === 1,
  })
})
