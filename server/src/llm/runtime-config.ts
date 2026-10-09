import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../db/index.js'
import { env, type LLMEnvConfig, type LLMKind } from '../env.js'

export type Effort = 'low' | 'high' | 'max' | ''

export interface LLMRuntimeConfig extends LLMEnvConfig {
  effort: Effort
}

export type LLMConfigSource = 'env' | 'ui'

export interface ResolvedLLM {
  config: LLMRuntimeConfig
  source: LLMConfigSource
  configured: boolean
}

const CONFIG_FILE = path.join(DATA_DIR, 'llm-config.json')

interface StoredFile {
  fast?: Partial<LLMRuntimeConfig>
  strong?: Partial<LLMRuntimeConfig>
}

let cache: StoredFile | null = null

function readFile(): StoredFile {
  if (cache) return cache
  if (!existsSync(CONFIG_FILE)) {
    cache = {}
    return cache
  }
  try {
    cache = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as StoredFile
  } catch {
    cache = {}
  }
  return cache
}

function writeFile(next: StoredFile): void {
  cache = next
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8')
  try {
    chmodSync(CONFIG_FILE, 0o600) // 含密钥
  } catch {
    // ignore
  }
}

/** 界面上保存的配置（未设置返回 null） */
export function getStoredConfig(kind: LLMKind): Partial<LLMRuntimeConfig> | null {
  const all = readFile()
  const raw = kind === 'fast' ? all.fast : all.strong
  if (!raw) return null
  return raw
}

/** 合并后的最终配置：界面配置优先于 .env */
export function resolveLLM(kind: LLMKind): ResolvedLLM {
  const envBase = kind === 'fast' ? envFast() : envStrong()
  const stored = getStoredConfig(kind)
  if (!stored) {
    return { config: envBase, source: 'env', configured: isReady(envBase) }
  }
  const config: LLMRuntimeConfig = {
    // 空字符串视为“未填写”，回退到 .env：否则只改模型名就会把密钥清空
    baseURL: stored.baseURL || envBase.baseURL,
    apiKey: stored.apiKey || envBase.apiKey,
    model: stored.model || envBase.model,
    // effort 的空串表示“默认”，是有效值，因此用 ??
    effort: stored.effort ?? envBase.effort,
  }
  return { config, source: 'ui', configured: isReady(config) }
}

export function isReady(c: LLMRuntimeConfig): boolean {
  return Boolean(c.baseURL && c.apiKey && c.model)
}

function envFast(): LLMRuntimeConfig {
  return { ...env.fast }
}

function envStrong(): LLMRuntimeConfig {
  return { ...env.strong }
}

const MASK = '••••••'

/** 保存界面配置（打码值不覆盖已有密钥） */
export function saveStoredConfig(kind: LLMKind, patch: Partial<LLMRuntimeConfig>): void {
  const all = { ...readFile() }
  const prev = (kind === 'fast' ? all.fast : all.strong) ?? {}
  const next: Partial<LLMRuntimeConfig> = { ...prev }
  for (const key of ['baseURL', 'apiKey', 'model', 'effort'] as const) {
    const v = patch[key]
    if (v === undefined) continue
    if (key === 'apiKey' && v === MASK) continue // 保持原值
    ;(next as Record<string, unknown>)[key] = v
  }
  if (kind === 'fast') all.fast = next
  else all.strong = next
  writeFile(all)
}

/** 清除界面配置，恢复使用 .env */
export function clearStoredConfig(kind: LLMKind): void {
  const all = { ...readFile() }
  if (kind === 'fast') delete all.fast
  else delete all.strong
  writeFile(all)
}

export function clearAllStoredConfig(): void {
  writeFile({})
  if (existsSync(CONFIG_FILE)) {
    try {
      unlinkSync(CONFIG_FILE)
    } catch {
      // ignore
    }
  }
  cache = null
}

/** 返回给前端的安全视图（密钥打码） */
export function maskConfig(kind: LLMKind) {
  const { config, source, configured } = resolveLLM(kind)
  const stored = getStoredConfig(kind)
  return {
    baseURL: config.baseURL,
    model: config.model,
    effort: config.effort,
    apiKey: stored?.apiKey ? MASK : '',
    configured,
    source,
    usingUI: stored !== null,
  }
}

export { MASK }
