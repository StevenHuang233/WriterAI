import { Hono } from 'hono'
import { z } from 'zod'
import {
  createProject, deleteProject, getProject, listChapterMetas, listChaptersFull,
  listLore, listProjects, updateProject,
} from '../db/repo.js'
import { rebuildGlobalSummary } from '../jobs/summarizer.js'
import { buildExport } from '../services/export.js'
import { notFound, parseBody } from './util.js'
import { toLoreDTO } from './lore.js'

export const projectsRoute = new Hono()

const CreateSchema = z.object({ title: z.string().trim().min(1).max(200) })
const PatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  synopsis: z.string().max(20000).optional(),
  style_note: z.string().max(10000).optional(),
  global_summary: z.string().max(20000).optional(),
})

projectsRoute.get('/projects', (c) => {
  return c.json(listProjects())
})

projectsRoute.post('/projects', async (c) => {
  const body = await parseBody(c, CreateSchema)
  return c.json(createProject(body.title), 201)
})

projectsRoute.get('/projects/:id', (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) notFound('项目不存在')
  return c.json({
    project,
    chapters: listChapterMetas(id),
    lore: listLore(id).map(toLoreDTO),
  })
})

projectsRoute.patch('/projects/:id', async (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const body = await parseBody(c, PatchSchema)
  updateProject(id, body)
  return c.json(getProject(id))
})

projectsRoute.delete('/projects/:id', (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  deleteProject(id)
  return c.json({ ok: true })
})

projectsRoute.post('/projects/:id/rebuild-summary', async (c) => {
  const id = c.req.param('id')
  if (!getProject(id)) notFound('项目不存在')
  const globalSummary = await rebuildGlobalSummary(id)
  return c.json({ global_summary: globalSummary })
})

const ExportQuerySchema = z.object({
  format: z.enum(['txt', 'md', 'html', 'docx', 'zip']).optional().default('txt'),
  scope: z.enum(['all', 'chapter']).optional().default('all'),
  chapterIds: z.string().max(5000).optional(),
  titleTemplate: z.enum(['cn', 'num', 'dot', 'plain']).optional().default('cn'),
  frontMatter: z.enum(['0', '1']).optional(),
  splitLong: z.enum(['0', '1']).optional(),
  download: z.enum(['0', '1']).optional(),
})

projectsRoute.get('/projects/:id/export', async (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) notFound('项目不存在')

  const parsed = ExportQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  const q = parsed.success ? parsed.data : { format: 'txt' as const, scope: 'all' as const, titleTemplate: 'cn' as const }

  const out = await buildExport(project, listChaptersFull(id), {
    format: q.format,
    scope: q.scope,
    chapterIds: q.chapterIds ? q.chapterIds.split(',').filter(Boolean) : undefined,
    titleTemplate: q.titleTemplate,
    frontMatter: q.frontMatter === '1',
    splitLong: q.splitLong === '1',
  })

  const encoded = encodeURIComponent(out.filename)
  return c.body(out.body as never, 200, {
    'content-type': out.mime,
    'content-disposition': `${q.download === '0' ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
  })
})
