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
  /** 推理模型思考力度；仅在配置了 *_EFFORT 时传递 */
  effort?: 'low' | 'high' | 'max'
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
    ...(opts.effort ? { effort: opts.effort } : {}),
  }
}

/** 创建流式对话（返回 SDK Stream，可用 stream.controller.abort() 中断） */
export async function createChatStream(kind: LLMKind, messages: ChatMessage[], opts: ChatOptions = {}) {
  const client = getClient(kind)
  return client.chat.completions.create({ ...params(kind, messages, opts), stream: true })
}

/** 流式对话，逐段 yield 增量文本 */
export async function* streamChat(kind: LLMKind, messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<string> {
  const stream = await createChatStream(kind, messages, opts)
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

/**
 * 非流式对话（带空结果重试）。
 * 推理模型可能把 token 预算全部用在“思考”上导致正文为空，
 * 此时自动加大预算并降低思考力度重试，最多 3 次。
 */
export async function chatOnceRobust(kind: LLMKind, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  let result = ''
  for (let attempt = 0; attempt < 3 && !result.trim(); attempt++) {
    const next: ChatOptions =
      attempt === 0
        ? opts
        : {
            ...opts,
            maxTokens: Math.max(opts.maxTokens ?? 1000, 1000) * (attempt === 1 ? 3 : 6),
            effort: 'low',
          }
    result = await chatOnce(kind, messages, next)
  }
  return result
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
