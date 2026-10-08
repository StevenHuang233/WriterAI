import { Hono } from 'hono'
import { z } from 'zod'
import { createLore, deleteLore, getLore, getProject, listLore, updateLore, type LoreRow } from '../db/repo.js'
import { notFound, parseBody } from './util.js'

export const loreRoute = new Hono()

export const LoreTypeSchema = z.enum(['character', 'location', 'item', 'faction', 'world', 'other'])

export interface LoreDTO {
  id: string
  project_id: string
  type: 'character' | 'location' | 'item' | 'faction' | 'world' | 'other'
  name: string
  aliases: string[]
  content: string
  current_state: string
  always_on: boolean
  priority: number
  enabled: boolean
  updated_at: number
}

export function safeParseAliases(aliases: string): string[] {
  try {
    const v = JSON.parse(aliases)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function toLoreDTO(row: LoreRow): LoreDTO {
  return {
    id: row.id,
    project_id: row.project_id,
    type: row.type,
    name: row.name,
    aliases: safeParseAliases(row.aliases),
    content: row.content,
    current_state: row.current_state,
    always_on: !!row.always_on,
    priority: row.priority,
    enabled: !!row.enabled,
    updated_at: row.updated_at,
  }
}

const CreateSchema = z.object({
  type: LoreTypeSchema,
  name: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  content: z.string().max(20000).optional(),
  current_state: z.string().max(2000).optional(),
  always_on: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
})

const PatchSchema = CreateSchema.partial()

loreRoute.get('/projects/:projectId/lore', (c) => {
  const projectId = c.req.param('projectId')
  if (!getProject(projectId)) notFound('项目不存在')
  return c.json(listLore(projectId).map(toLoreDTO))
})

loreRoute.post('/projects/:projectId/lore', async (c) => {
  const projectId = c.req.param('projectId')
  if (!getProject(projectId)) notFound('项目不存在')
  const body = await parseBody(c, CreateSchema)
  const row = createLore(projectId, {
    type: body.type,
    name: body.name,
    aliases: body.aliases ?? [],
    content: body.content ?? '',
    current_state: body.current_state ?? '',
    always_on: body.always_on ?? false,
    priority: body.priority ?? 0,
    enabled: body.enabled ?? true,
  })
  return c.json(toLoreDTO(row), 201)
})

loreRoute.patch('/lore/:id', async (c) => {
  const id = c.req.param('id')
  if (!getLore(id)) notFound('设定条目不存在')
  const body = await parseBody(c, PatchSchema)
  updateLore(id, body)
  return c.json(toLoreDTO(getLore(id)!))
})

loreRoute.delete('/lore/:id', (c) => {
  const id = c.req.param('id')
  if (!getLore(id)) notFound('设定条目不存在')
  deleteLore(id)
  return c.json({ ok: true })
})
