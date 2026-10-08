import OpenAI from 'openai'
import { env, type LLMKind } from '../env.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
}

const cache: Partial<Record<LLMKind, OpenAI>> = {}

export function getClient(kind: LLMKind): OpenAI {
  if (!cache[kind]) {
    const c = env[kind]
    cache[kind] = new OpenAI({
      baseURL: c.baseURL,
      // Ollama 等本地服务无鉴权，占位即可
      apiKey: c.apiKey || 'none',
      maxRetries: 1,
      timeout: kind === 'fast' ? 60_000 : 180_000,
    })
  }
  return cache[kind]!
}

function params(kind: LLMKind, messages: ChatMessage[], opts: ChatOptions) {
  return {
    model: env[kind].model,
    messages,
    temperature: opts.temperature ?? 0.8,
    ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.stop && opts.stop.length > 0 ? { stop: opts.stop } : {}),
  }
}

/** 流式对话，逐段 yield 增量文本 */
export async function* streamChat(kind: LLMKind, messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<string> {
  const client = getClient(kind)
  const stream = await client.chat.completions.create(
    { ...params(kind, messages, opts), stream: true },
    ...(opts.signal ? [{ signal: opts.signal }] : []),
  )
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}

/** 非流式对话，返回完整文本 */
export async function chatOnce(kind: LLMKind, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const client = getClient(kind)
  const res = await client.chat.completions.create(
    { ...params(kind, messages, opts), stream: false },
    ...(opts.signal ? [{ signal: opts.signal }] : []),
  )
  return res.choices?.[0]?.message?.content?.trim() ?? ''
}

/** 从模型输出中提取第一个 JSON 对象（容错解析） */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}
