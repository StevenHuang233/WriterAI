import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../db/index.js'
import type { SyncProviderConfig, SyncProviderType } from './providers.js'

export interface SyncSettings {
  /** 是否开启自动备份 */
  autoSync: boolean
  /** 自动备份间隔（分钟） */
  autoSyncMinutes: number
}

export interface SyncState extends SyncSettings {
  provider: SyncProviderConfig | null
  lastPushAt: number | null
  lastPullAt: number | null
  dirty: boolean
}

const CONFIG_FILE = path.join(DATA_DIR, 'sync-config.json')

const DEFAULT_STATE: SyncState = {
  provider: null,
  autoSync: false,
  autoSyncMinutes: 10,
  lastPushAt: null,
  lastPullAt: null,
  dirty: false,
}

let cache: SyncState | null = null

export function getSyncState(): SyncState {
  if (cache) return cache
  if (!existsSync(CONFIG_FILE)) {
    cache = { ...DEFAULT_STATE }
    return cache
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<SyncState>
    cache = {
      ...DEFAULT_STATE,
      ...raw,
      provider: (raw.provider ?? null) as SyncProviderConfig | null,
    }
  } catch {
    cache = { ...DEFAULT_STATE }
  }
  return cache
}

export function saveSyncState(patch: Partial<SyncState>): SyncState {
  const next = { ...getSyncState(), ...patch }
  cache = next
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8')
  try {
    chmodSync(CONFIG_FILE, 0o600) // 含密钥，仅当前用户可读
  } catch {
    // 某些文件系统不支持，忽略
  }
  return next
}

const MASK = '••••••'

/** 密钥字段打码后再返回给前端 */
export function maskState(state: SyncState): {
  provider: (Omit<SyncProviderConfig, 'secretAccessKey' | 'password' | 'token'> & Record<string, unknown>) | null
  autoSync: boolean
  autoSyncMinutes: number
  lastPushAt: number | null
  lastPullAt: number | null
} {
  const p = state.provider
  let provider = null as unknown as Record<string, unknown> | null
  if (p) {
    const masked: Record<string, unknown> = { ...p }
    if (p.type === 's3') {
      masked.secretAccessKey = p.secretAccessKey ? MASK : ''
      masked.accessKeyId = p.accessKeyId ? MASK : ''
    } else if (p.type === 'webdav') {
      masked.password = p.password ? MASK : ''
    } else if (p.type === 'gist') {
      masked.token = p.token ? MASK : ''
    }
    provider = masked
  }
  return {
    provider: provider as never,
    autoSync: state.autoSync,
    autoSyncMinutes: state.autoSyncMinutes,
    lastPushAt: state.lastPushAt,
    lastPullAt: state.lastPullAt,
  }
}

/** 前端回填的打码值不应覆盖已保存的密钥 */
export function mergeSecrets(next: SyncProviderConfig, prev: SyncProviderConfig | null): SyncProviderConfig {
  if (!prev || prev.type !== next.type) return next
  if (next.type === 's3' && prev.type === 's3') {
    return {
      ...next,
      accessKeyId: next.accessKeyId === MASK ? prev.accessKeyId : next.accessKeyId,
      secretAccessKey: next.secretAccessKey === MASK ? prev.secretAccessKey : next.secretAccessKey,
    }
  }
  if (next.type === 'webdav' && prev.type === 'webdav') {
    return { ...next, password: next.password === MASK ? prev.password : next.password }
  }
  if (next.type === 'gist' && prev.type === 'gist') {
    return { ...next, token: next.token === MASK ? prev.token : next.token }
  }
  return next
}

export { MASK }
export type { SyncProviderType }
