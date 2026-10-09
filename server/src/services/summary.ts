export interface MultiLevel {
  summary: string
  brief: string
  micro: string
}

const MARKERS = [
  { key: 'summary' as const, tag: '【完整】', next: ['【一句话】', '【极简】'] },
  { key: 'brief' as const, tag: '【一句话】', next: ['【极简】'] },
  { key: 'micro' as const, tag: '【极简】', next: [] },
]

/**
 * 解析模型输出的三层摘要。
 * 优先按「【完整】/【一句话】/【极简】」标记行解析（实测该格式对模型最稳定）；
 * 若模型只输出一段，则退化：整段作为完整摘要，并截取短句作为下层。
 */
export function parseMultiLevel(raw: string): MultiLevel | null {
  const text = (raw ?? '').trim()
  if (!text) return null

  const out: MultiLevel = { summary: '', brief: '', micro: '' }
  for (const m of MARKERS) {
    const start = text.indexOf(m.tag)
    if (start < 0) continue
    let end = text.length
    for (const n of m.next) {
      const i = text.indexOf(n, start + m.tag.length)
      if (i >= 0) end = Math.min(end, i)
    }
    // 截断到下一个空行，避免把模型多余的客套话带进来
    const chunk = text.slice(start + m.tag.length, end)
    const blankLine = chunk.search(/\n\s*\n/)
    out[m.key] = (blankLine >= 0 ? chunk.slice(0, blankLine) : chunk).trim()
  }

  if (!out.summary && !out.brief && !out.micro) {
    // 没有标记：整段当完整摘要
    const oneLine = text.replace(/\s+/g, ' ').trim()
    return {
      summary: oneLine,
      brief: oneLine.slice(0, 60),
      micro: oneLine.slice(0, 20),
    }
  }

  if (!out.summary) out.summary = out.brief || out.micro
  if (!out.brief) out.brief = out.summary.slice(0, 60)
  if (!out.micro) out.micro = out.brief.slice(0, 20)
  return out
}
