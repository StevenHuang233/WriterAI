import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { env, REPO_ROOT } from './env.js'
import { projectsRoute } from './routes/projects.js'
import { chaptersRoute } from './routes/chapters.js'
import { loreRoute } from './routes/lore.js'
import { suggestRoute } from './routes/suggest.js'
import { settingsRoute } from './routes/settings.js'
import { syncRoute } from './routes/sync.js'
import { toolsRoute } from './routes/tools.js'
import { startAutoSync } from './jobs/autoSync.js'

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: { code: err.status, message: err.message || '请求错误' } }, err.status)
  }
  console.error('[server] 未处理错误:', err)
  return c.json({ error: { code: 500, message: err instanceof Error ? err.message : '服务器内部错误' } }, 500)
})

const api = new Hono()
api.route('/', projectsRoute)
api.route('/', chaptersRoute)
api.route('/', loreRoute)
api.route('/', suggestRoute)
api.route('/', settingsRoute)
api.route('/', syncRoute)
api.route('/', toolsRoute)
app.route('/api', api)

startAutoSync()

// 生产模式：托管前端构建产物
const webDist = path.join(REPO_ROOT, 'web', 'dist')
if (existsSync(webDist)) {
  const rel = path.relative(process.cwd(), webDist)
  app.use('/*', serveStatic({ root: rel }))
  const indexPath = path.join(webDist, 'index.html')
  app.get('*', (c) => c.html(readFileSync(indexPath, 'utf8')))
}

serve({ fetch: app.fetch, port: env.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`WriterAI server 运行在 http://127.0.0.1:${info.port}`)
  if (!env.fast.model) console.warn('[server] 警告：未配置 FAST_* 模型，实时提词不可用。请复制 .env.example 为 .env 并填写。')
  if (!env.strong.model) console.warn('[server] 警告：未配置 STRONG_* 模型，摘要与续写不可用。')
})
