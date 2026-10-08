import { Hono } from 'hono'
import { z } from 'zod'
import {
  createProject, deleteProject, getProject, listChapterMetas, listChaptersFull,
  listLore, listProjects, updateProject,
} from '../db/repo.js'
import { rebuildGlobalSummary } from '../jobs/summarizer.js'
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

projectsRoute.get('/projects/:id/export', (c) => {
  const id = c.req.param('id')
  const project = getProject(id)
  if (!project) notFound('项目不存在')
  const format = c.req.query('format') === 'md' ? 'md' : 'txt'
  const chapters = listChaptersFull(id)
  let body: string
  if (format === 'md') {
    body = `# ${project.title}\n\n${project.synopsis ? `> ${project.synopsis}\n\n` : ''}${chapters.map((ch) => `## ${ch.title}\n\n${ch.content}`).join('\n\n')}\n`
  } else {
    body = `${project.title}\n\n${chapters.map((ch) => `${ch.title}\n\n${ch.content}`).join('\n\n')}\n`
  }
  const filename = encodeURIComponent(`${project.title}.${format}`)
  return c.body(body, 200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-disposition': `attachment; filename*=UTF-8''${filename}`,
  })
})
