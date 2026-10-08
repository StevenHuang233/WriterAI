export interface LoreLike {
  id: string
  name: string
  aliases: string[]
  priority: number
  alwaysOn: boolean
  enabled: boolean
}

export interface LoreHit {
  id: string
  name: string
  /** 命中的词（可能是别名） */
  hit: string
  /** 命中位置（越靠后越靠近光标方向，由调用方保证 text 末尾靠近光标） */
  pos: number
  priority: number
}

/**
 * 在 text 中匹配设定条目（名称 + 别名）。
 * - 单字名不参与匹配，防止误触发
 * - 同名多条词时记录最靠后的命中位置与最长词
 * - 排序：priority 降序 → 命中位置降序（越近越优先）
 */
export function matchLore(entries: LoreLike[], text: string, maxEntries: number): LoreHit[] {
  const hits: LoreHit[] = []
  for (const e of entries) {
    if (!e.enabled) continue
    const terms = [e.name, ...e.aliases].map((t) => t.trim()).filter((t) => t.length > 1)
    if (terms.length === 0) continue
    let best: { hit: string; pos: number } | null = null
    for (const term of terms) {
      const idx = text.lastIndexOf(term)
      if (idx < 0) continue
      if (!best || idx > best.pos || (idx === best.pos && term.length > best.hit.length)) {
        best = { hit: term, pos: idx }
      }
    }
    if (best) hits.push({ id: e.id, name: e.name, hit: best.hit, pos: best.pos, priority: e.priority })
  }

  // 同位置命中：一个词是另一个词的前缀时，保留更长的词（“张三丰”胜过“张三”）
  const filtered: LoreHit[] = []
  for (const h of hits) {
    const dupIdx = filtered.findIndex((f) => f.pos === h.pos && (f.hit.startsWith(h.hit) || h.hit.startsWith(f.hit)))
    if (dupIdx >= 0) {
      if (h.hit.length > filtered[dupIdx]!.hit.length) filtered[dupIdx] = h
    } else {
      filtered.push(h)
    }
  }

  filtered.sort((a, b) => b.priority - a.priority || b.pos - a.pos)
  return filtered.slice(0, maxEntries)
}
