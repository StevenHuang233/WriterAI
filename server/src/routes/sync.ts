import { Hono } from 'hono'
import { z } from 'zod'
import { createProvider, type SyncProviderConfig } from '../sync/providers.js'
import { getSyncState, maskState, mergeSecrets, saveSyncState } from '../sync/config.js'
import { exportSnapshot, importSnapshot, localCounts, parseSnapshot } from '../sync/snapshot.js'
import { badRequest, parseBody } from './util.js'

export const syncRoute = new Hono()

const BaseProviderSchema = z.object({ type: z.enum(['local', 's3', 'webdav', 'gist']) })

const LocalSchema = z.object({ type: z.literal('local'), dir: z.string().min(1).max(500) })
const S3Schema = z.object({
  type: z.literal('s3'),
  endpoint: z.string().min(1).max(500),
  region: z.string().max(100).optional().default(''),
  bucket: z.string().min(1).max(200),
  key: z.string().max(300).optional().default(''),
  accessKeyId: z.string().max(300).optional().default(''),
  secretAccessKey: z.string().max(500).optional().default(''),
})
const WebdavSchema = z.object({
  type: z.literal('webdav'),
  url: z.string().min(1).max(1000),
  username: z.string().max(200).optional().default(''),
  password: z.string().max(500).optional().default(''),
})
const GistSchema = z.object({
  type: z.literal('gist'),
  token: z.string().max(300).optional().default(''),
  gistId: z.string().max(200).optional().default(''),
})

const ProviderSchema = z.discriminatedUnion('type', [LocalSchema, S3Schema, WebdavSchema, GistSchema])
void BaseProviderSchema

const ConfigSchema = z.object({
  provider: ProviderSchema.nullable().optional(),
  autoSync: z.boolean().optional(),
  autoSyncMinutes: z.number().int().min(1).max(1440).optional(),
})

/** 当前配置（密钥打码） */
syncRoute.get('/sync/config', (c) => {
  const state = getSyncState()
  return c.json({ ...maskState(state), local: localCounts() })
})

/** 保存配置 */
syncRoute.put('/sync/config', async (c) => {
  const body = await parseBody(c, ConfigSchema)
  const prev = getSyncState()
  const patch: Parameters<typeof saveSyncState>[0] = {}
  if (body.provider !== undefined) {
    patch.provider = body.provider ? mergeSecrets(body.provider as SyncProviderConfig, prev.provider) : null
  }
  if (body.autoSync !== undefined) patch.autoSync = body.autoSync
  if (body.autoSyncMinutes !== undefined) patch.autoSyncMinutes = body.autoSyncMinutes
  const next = saveSyncState(patch)
  return c.json({ ...maskState(next), local: localCounts() })
})

/** 测试连接 */
syncRoute.post('/sync/test', async (c) => {
  const body = await parseBody(c, ConfigSchema)
  const prev = getSyncState()
  const cfg = body.provider ? mergeSecrets(body.provider as SyncProviderConfig, prev.provider) : prev.provider
  if (!cfg) badRequest('还没有配置云端')
  try {
    const res = await createProvider(cfg).test()
    return c.json(res)
  } catch (e) {
    return c.json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
})

/** 备份到云端（带冲突检测：云端被别处更新过则拒绝，除非 force） */
syncRoute.post('/sync/push', async (c) => {
  const state = getSyncState()
  if (!state.provider) badRequest('还没有配置云端')
  const force = c.req.query('force') === 'true'
  const provider = createProvider(state.provider)

  // 读取云端，判断是否在别处被更新过
  let remoteText: string | null = null
  let remoteSavedAt: number | null = null
  try {
    remoteText = await provider.get()
    if (remoteText) remoteSavedAt = parseSnapshot(JSON.parse(remoteText)).savedAt
  } catch {
    // 读取失败不阻止备份
  }
  if (!force && remoteSavedAt && state.lastSyncedRemoteAt && remoteSavedAt !== state.lastSyncedRemoteAt) {
    return c.json(
      {
        conflict: true,
        message: '云端已被其他设备更新，继续上传会覆盖它。请先从云端恢复，或选择强制覆盖。',
        remoteSavedAt,
        localSavedAt: state.lastSyncedRemoteAt,
      },
      409,
    )
  }

  // 上传前把云端上一版另存为 .bak
  if (remoteText) {
    try {
      await provider.putBackup(remoteText)
    } catch (e) {
      console.warn('[sync] 保存上一版失败：', e instanceof Error ? e.message : String(e))
    }
  }

  const snap = exportSnapshot()
  const text = JSON.stringify(snap)
  await provider.put(text)
  const next = saveSyncState({
    lastPushAt: Date.now(),
    lastSyncedRemoteAt: snap.savedAt,
    dirty: false,
    // Gist 首次上传会生成 id，需写回
    provider: state.provider,
  })
  return c.json({
    ok: true,
    savedAt: snap.savedAt,
    bytes: Buffer.byteLength(text, 'utf8'),
    projects: snap.projects.length,
    lastPushAt: next.lastPushAt,
  })
})

/** 查看云端备份信息（不返回全部正文）；source=bak 查看上一版 */
syncRoute.get('/sync/remote', async (c) => {
  const state = getSyncState()
  if (!state.provider) badRequest('还没有配置云端')
  const provider = createProvider(state.provider)
  const text = c.req.query('source') === 'bak' ? await provider.getBackup() : await provider.get()
  if (!text) return c.json({ exists: false })
  const snap = parseSnapshot(JSON.parse(text))
  const chapters = snap.projects.reduce((s, p) => s + p.chapters.length, 0)
  return c.json({
    exists: true,
    savedAt: snap.savedAt,
    bytes: Buffer.byteLength(text, 'utf8'),
    projects: snap.projects.map((p) => ({ title: p.project.title, chapters: p.chapters.length })),
    chapters,
  })
})

/** 从云端恢复（source=bak 时从上一版恢复） */
syncRoute.post('/sync/pull', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      mode: z.enum(['merge', 'replace']).optional().default('merge'),
      source: z.enum(['main', 'bak']).optional().default('main'),
    }),
  )
  const state = getSyncState()
  if (!state.provider) badRequest('还没有配置云端')
  const provider = createProvider(state.provider)
  const text = body.source === 'bak' ? await provider.getBackup() : await provider.get()
  if (!text) badRequest(body.source === 'bak' ? '云端还没有上一版备份' : '云端还没有备份文件')
  const snap = parseSnapshot(JSON.parse(text))
  const counts = importSnapshot(snap, body.mode)
  const next = saveSyncState({
    lastPullAt: Date.now(),
    // 从上一版恢复时，云端主文件未变，不更新同步基准
    lastSyncedRemoteAt: body.source === 'bak' ? state.lastSyncedRemoteAt : snap.savedAt,
    dirty: false,
  })
  return c.json({ ok: true, mode: body.mode, savedAt: snap.savedAt, counts, lastPullAt: next.lastPullAt })
})
