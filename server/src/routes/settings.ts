import { Hono } from 'hono'
import { z } from 'zod'
import { chatOnce } from '../llm/client.js'
import {
  clearStoredConfig, maskConfig, resolveLLM, saveStoredConfig, type Effort,
} from '../llm/runtime-config.js'
import { resetClients } from '../llm/client.js'
import { badRequest, parseBody } from './util.js'

export const settingsRoute = new Hono()

const KIND = z.enum(['fast', 'strong'])

const LLMConfigSchema = z.object({
  baseURL: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  effort: z.enum(['low', 'high', 'max', '']).optional(),
})

const SaveSchema = z.object({
  fast: LLMConfigSchema.optional(),
  strong: LLMConfigSchema.optional(),
})

/** 当前模型配置（密钥打码） */
settingsRoute.get('/settings', (c) => {
  return c.json({
    fast: maskConfig('fast'),
    strong: maskConfig('strong'),
  })
})

/** 保存模型配置并立即生效 */
settingsRoute.put('/settings', async (c) => {
  const body = await parseBody(c, SaveSchema)
  if (body.fast) saveStoredConfig('fast', { ...body.fast, effort: (body.fast.effort ?? '') as Effort })
  if (body.strong) saveStoredConfig('strong', { ...body.strong, effort: (body.strong.effort ?? '') as Effort })
  resetClients()
  return c.json({ ok: true, fast: maskConfig('fast'), strong: maskConfig('strong') })
})

/** 恢复使用 .env 里的配置 */
settingsRoute.post('/settings/reset', async (c) => {
  const body = await parseBody(c, z.object({ kind: KIND.optional() }).optional().default({}))
  if (body.kind) clearStoredConfig(body.kind)
  else {
    clearStoredConfig('fast')
    clearStoredConfig('strong')
  }
  resetClients()
  return c.json({ ok: true, fast: maskConfig('fast'), strong: maskConfig('strong') })
})

/** 测试某个模型能否正常调用 */
settingsRoute.post('/settings/test', async (c) => {
  const body = await parseBody(c, z.object({ kind: KIND }))
  const { config, configured } = resolveLLM(body.kind)
  if (!configured) {
    return c.json({ ok: false, message: '配置不完整：需要 Base URL、密钥和模型名' })
  }
  const started = Date.now()
  try {
    const text = await chatOnce(
      body.kind,
      [{ role: 'user', content: '回复两个字：你好' }],
      { maxTokens: 60, temperature: 0.2, effort: (config.effort || undefined) as 'low' | 'high' | 'max' | undefined },
    )
    return c.json({
      ok: true,
      message: `调用成功，${Date.now() - started}ms${text ? `，返回：${text.slice(0, 20)}` : ''}`,
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    return c.json({ ok: false, message: e instanceof Error ? e.message.slice(0, 300) : String(e) })
  }
})

/** 拉取该服务可用的模型列表，方便选择 */
settingsRoute.post('/settings/models', async (c) => {
  const body = await parseBody(c, z.object({ kind: KIND }))
  const { config } = resolveLLM(body.kind)
  if (!config.baseURL) badRequest('请先填写 Base URL')
  let url = config.baseURL.replace(/\/+$/, '')
  if (!url.endsWith('/models')) url += '/models'
  if (!/^https?:\/\//i.test(url)) badRequest('Base URL 必须以 http:// 或 https:// 开头')
  try {
    const res = await fetch(url, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
    })
    if (!res.ok) return c.json({ ok: false, message: `获取失败 ${res.status}`, models: [] })
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const models = (data.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x))
    return c.json({ ok: true, models, message: models.length ? `共 ${models.length} 个模型` : '该服务没有返回模型列表' })
  } catch (e) {
    return c.json({ ok: false, message: e instanceof Error ? e.message.slice(0, 200) : String(e), models: [] })
  }
})
