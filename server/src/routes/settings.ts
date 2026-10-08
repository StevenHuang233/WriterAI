import { Hono } from 'hono'
import { env, llmReady } from '../env.js'
import { listJobs } from '../jobs/summarizer.js'

export const settingsRoute = new Hono()

/** 只返回模型名与配置状态，绝不返回密钥 */
settingsRoute.get('/settings', (c) => {
  return c.json({
    fast: { model: env.fast.model || '(未配置)', configured: llmReady('fast') },
    strong: { model: env.strong.model || '(未配置)', configured: llmReady('strong') },
  })
})

settingsRoute.get('/jobs', (c) => {
  return c.json(listJobs())
})
