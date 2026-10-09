import { Hono } from 'hono'
import { z } from 'zod'
import { chatOnceRobust, extractJson } from '../llm/client.js'
import { detectCharactersPrompt, fillCharacterPrompt, inferRelationsPrompt } from '../llm/prompts.js'
import { env } from '../env.js'
import {
  addStateHistory, createLore, createRelation, deleteRelation, getCharacterProfile, getLore,
  listChaptersFull, listLore, listRelations, listRelationsFor, listStateHistory,
  updateLore, upsertCharacterProfile, type LoreRow,
} from '../db/repo.js'
import { searchChapters } from '../services/search.js'
import { badRequest, notFound, parseBody } from './util.js'

export const charactersRoute = new Hono()

const PROFILE_KEYS = ['gender', 'age', 'role', 'appearance', 'personality', 'motivation', 'catchphrase', 'avatar', 'color'] as const

const ProfileSchema = z.object({
  gender: z.string().max(50).optional(),
  age: z.string().max(50).optional(),
  role: z.string().max(300).optional(),
  appearance: z.string().max(2000).optional(),
  personality: z.string().max(2000).optional(),
  motivation: z.string().max(2000).optional(),
  catchphrase: z.string().max(500).optional(),
  avatar: z.string().max(20).optional(),
  color: z.string().max(20).optional(),
})

function toLoreDTO(row: LoreRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    type: row.type,
    name: row.name,
    aliases: JSON.parse(row.aliases) as string[],
    content: row.content,
    current_state: row.current_state,
    always_on: !!row.always_on,
    priority: row.priority,
    enabled: !!row.enabled,
    updated_at: row.updated_at,
  }
}

/** 人物列表（含档案与关系） */
charactersRoute.get('/projects/:id/characters', (c) => {
  const id = c.req.param('id')
  const lore = listLore(id).filter((l) => l.type === 'character')
  const relations = listRelations(id)
  return c.json({
    characters: lore.map((l) => ({
      ...toLoreDTO(l),
      profile: getCharacterProfile(l.id) ?? null,
    })),
    relations,
  })
})

/** 更新人物档案字段 */
charactersRoute.patch('/characters/:loreId/profile', async (c) => {
  const loreId = c.req.param('loreId')
  const lore = getLore(loreId)
  if (!lore) notFound('人物不存在')
  const body = await parseBody(c, ProfileSchema)
  upsertCharacterProfile(loreId, lore.project_id, body)
  return c.json(getCharacterProfile(loreId))
})

/** 某个人物的出场章节与次数 */
charactersRoute.get('/characters/:loreId/appearances', (c) => {
  const loreId = c.req.param('loreId')
  const lore = getLore(loreId)
  if (!lore) notFound('人物不存在')
  const chapters = listChaptersFull(lore.project_id)
  const names = [lore.name, ...(JSON.parse(lore.aliases) as string[])]
  const perChapter = []
  let total = 0
  for (const ch of chapters) {
    let count = 0
    for (const n of names) {
      if (n.trim().length > 1) count += searchChapters([ch], n).total
    }
    if (count > 0) {
      perChapter.push({ chapterId: ch.id, title: ch.title, sortOrder: ch.sort_order, count })
      total += count
    }
  }
  perChapter.sort((a, b) => a.sortOrder - b.sortOrder)
  return c.json({ total, chapters: perChapter })
})

/** 状态时间线 */
charactersRoute.get('/characters/:loreId/history', (c) => {
  const loreId = c.req.param('loreId')
  if (!getLore(loreId)) notFound('人物不存在')
  return c.json(listStateHistory(loreId))
})

/** 手动记录一条状态 */
charactersRoute.post('/characters/:loreId/history', async (c) => {
  const loreId = c.req.param('loreId')
  const lore = getLore(loreId)
  if (!lore) notFound('人物不存在')
  const body = await parseBody(c, z.object({ state: z.string().min(1).max(2000) }))
  addStateHistory(loreId, '', '手动记录', body.state)
  return c.json(listStateHistory(loreId), 201)
})

// ---------- 关系 ----------

charactersRoute.post('/projects/:id/relations', async (c) => {
  const id = c.req.param('id')
  const body = await parseBody(
    c,
    z.object({ a: z.string().min(1), b: z.string().min(1), label: z.string().max(300) }),
  )
  if (body.a === body.b) badRequest('不能和自己建立关系')
  const lore = listLore(id)
  if (!lore.some((l) => l.id === body.a) || !lore.some((l) => l.id === body.b)) badRequest('人物不存在')
  return c.json(createRelation(id, body.a, body.b, body.label), 201)
})

charactersRoute.delete('/relations/:id', (c) => {
  deleteRelation(c.req.param('id'))
  return c.json({ ok: true })
})

// ---------- AI 能力 ----------

/** 从正文识别人物并自动建卡 */
charactersRoute.post('/projects/:id/characters/detect', async (c) => {
  const id = c.req.param('id')
  const chapters = [...listChaptersFull(id)].sort((a, b) => b.sort_order - a.sort_order)
  let sample = ''
  for (const ch of chapters) {
    sample = ch.content.slice(-6000) + sample
    if (sample.length >= 12000) break
  }
  sample = sample.slice(-12000)
  if (sample.trim().length < 200) badRequest('正文太少，无法识别人物')

  const raw = await chatOnceRobust('strong', detectCharactersPrompt(sample), {
    maxTokens: 2500,
    temperature: 0.3,
    effort: env.strong.effort || undefined,
  })
  const parsed = z
    .object({
      characters: z
        .array(
          z.object({
            name: z.string().min(1).max(50),
            aliases: z.array(z.string().max(50)).max(10).optional().default([]),
            role: z.string().max(300).optional().default(''),
            appearance: z.string().max(2000).optional().default(''),
            personality: z.string().max(2000).optional().default(''),
            motivation: z.string().max(2000).optional().default(''),
            catchphrase: z.string().max(500).optional().default(''),
            note: z.string().max(2000).optional().default(''),
          }),
        )
        .max(50),
    })
    .safeParse(extractJson(raw) ?? {})

  if (!parsed.success || parsed.data.characters.length === 0) badRequest('没有从正文里识别出人物')

  const existing = listLore(id).filter((l) => l.type === 'character')
  const created: string[] = []
  for (const ch of parsed.data.characters) {
    if (existing.some((l) => l.name === ch.name)) continue
    const row = createLore(id, {
      type: 'character',
      name: ch.name,
      aliases: ch.aliases ?? [],
      content: ch.note || '',
      current_state: '',
      always_on: false,
      priority: 0,
      enabled: true,
    })
    upsertCharacterProfile(row.id, id, {
      role: ch.role,
      appearance: ch.appearance,
      personality: ch.personality,
      motivation: ch.motivation,
      catchphrase: ch.catchphrase,
    })
    created.push(ch.name)
  }
  return c.json({ ok: true, created, sampleChars: sample.length }, 201)
})

/** 根据正文补全某个人物的设定 */
charactersRoute.post('/characters/:loreId/fill', async (c) => {
  const loreId = c.req.param('loreId')
  const lore = getLore(loreId)
  if (!lore) notFound('人物不存在')
  const chapters = listChaptersFull(lore.project_id)
  const names = [lore.name, ...(JSON.parse(lore.aliases) as string[])]
  const hits: string[] = []
  for (const ch of chapters) {
    for (const n of names) {
      if (n.trim().length <= 1) continue
      const { matches } = searchChapters([ch], n)
      for (const m of matches.slice(0, 6)) {
        const start = Math.max(0, m.index - 120)
        hits.push(ch.content.slice(start, m.index + 200))
      }
    }
  }
  const sample = hits.join('\n…\n').slice(0, 8000)
  if (sample.trim().length < 50) badRequest('正文里还没有这个人物的出场片段')

  const raw = await chatOnceRobust('strong', fillCharacterPrompt(lore.name, sample), {
    maxTokens: 2000,
    temperature: 0.3,
    effort: env.strong.effort || undefined,
  })
  const parsed = z
    .object({
      gender: z.string().max(50).optional().default(''),
      age: z.string().max(50).optional().default(''),
      role: z.string().max(300).optional().default(''),
      appearance: z.string().max(2000).optional().default(''),
      personality: z.string().max(2000).optional().default(''),
      motivation: z.string().max(2000).optional().default(''),
      catchphrase: z.string().max(500).optional().default(''),
      content: z.string().max(5000).optional().default(''),
    })
    .safeParse(extractJson(raw) ?? {})
  if (!parsed.success) badRequest('模型没有返回可解析的人物设定')

  const d = parsed.data
  upsertCharacterProfile(loreId, lore.project_id, {
    gender: d.gender,
    age: d.age,
    role: d.role,
    appearance: d.appearance,
    personality: d.personality,
    motivation: d.motivation,
    catchphrase: d.catchphrase,
  })
  if (d.content.trim()) updateLore(loreId, { content: d.content })
  return c.json({ ok: true, profile: getCharacterProfile(loreId), sampleChars: sample.length })
})

/** 推断某个人物与其他人物的关系 */
charactersRoute.post('/characters/:loreId/infer-relations', async (c) => {
  const loreId = c.req.param('loreId')
  const lore = getLore(loreId)
  if (!lore) notFound('人物不存在')
  const others = listLore(lore.project_id).filter((l) => l.type === 'character' && l.id !== loreId)
  if (others.length === 0) badRequest('还没有其他人物可建立关系')

  const chapters = listChaptersFull(lore.project_id)
  const names = [lore.name, ...(JSON.parse(lore.aliases) as string[])]
  const hits: string[] = []
  for (const ch of chapters) {
    for (const n of names) {
      if (n.trim().length <= 1) continue
      const { matches } = searchChapters([ch], n)
      for (const m of matches.slice(0, 8)) {
        hits.push(ch.content.slice(Math.max(0, m.index - 150), m.index + 250))
      }
    }
  }
  const sample = hits.join('\n…\n').slice(0, 8000)
  if (sample.trim().length < 50) badRequest('正文里还没有这个人物的出场片段')

  const raw = await chatOnceRobust(
    'strong',
    inferRelationsPrompt(lore.name, others.map((o) => o.name), sample),
    { maxTokens: 1500, temperature: 0.3, effort: env.strong.effort || undefined },
  )
  const parsed = z
    .object({ relations: z.array(z.object({ name: z.string().max(50), label: z.string().max(300) })).max(50) })
    .safeParse(extractJson(raw) ?? {})
  if (!parsed.success) badRequest('模型没有返回可解析的关系')

  const existing = listRelationsFor(lore.project_id, [loreId])
  const added: string[] = []
  for (const r of parsed.data.relations) {
    const target = others.find((o) => o.name === r.name)
    if (!target || !r.label.trim()) continue
    const dup = existing.some(
      (e) =>
        (e.a_lore_id === loreId && e.b_lore_id === target.id) ||
        (e.b_lore_id === loreId && e.a_lore_id === target.id),
    )
    if (dup) continue
    createRelation(lore.project_id, loreId, target.id, r.label)
    added.push(`${r.name}：${r.label}`)
  }
  return c.json({ ok: true, added })
})
