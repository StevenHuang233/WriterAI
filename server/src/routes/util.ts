import { HTTPException } from 'hono/http-exception'
import type { Context } from 'hono'
import type { z } from 'zod'

export async function parseBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    throw new HTTPException(400, { message: '请求体不是合法 JSON' })
  }
  const r = schema.safeParse(json)
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new HTTPException(400, { message: `参数错误：${msg}` })
  }
  return r.data
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message })
}

export function notFound(message = '资源不存在'): never {
  throw new HTTPException(404, { message })
}
