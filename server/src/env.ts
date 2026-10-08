import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录（兼容 tsx 运行 src 与编译后运行 dist） */
export const REPO_ROOT = path.resolve(__dirname, '../..')

/**
 * 加载仓库根目录的 .env（不覆盖已有环境变量）。
 * 手写解析以避免额外依赖；同时保证 dev 与编译后运行行为一致。
 */
function loadEnvFile(): void {
  const file = path.join(REPO_ROOT, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || m[1] === undefined) continue
    let value = m[2] ?? ''
    const t = value.trim()
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      value = t.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

loadEnvFile()

export interface LLMEnvConfig {
  baseURL: string
  apiKey: string
  model: string
}

function readLLM(prefix: 'FAST' | 'STRONG'): LLMEnvConfig {
  return {
    baseURL: (process.env[`${prefix}_BASE_URL`] ?? '').trim(),
    apiKey: (process.env[`${prefix}_API_KEY`] ?? '').trim(),
    model: (process.env[`${prefix}_MODEL`] ?? '').trim(),
  }
}

export type LLMKind = 'fast' | 'strong'

export const env = {
  port: Number(process.env.PORT || 8787),
  fast: readLLM('FAST'),
  strong: readLLM('STRONG'),
}

export function llmReady(kind: LLMKind): boolean {
  const c = env[kind]
  return Boolean(c.baseURL && c.apiKey && c.model)
}
