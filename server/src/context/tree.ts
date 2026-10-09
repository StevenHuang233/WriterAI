import {
  buildHistoryChain, levelForMerge, nodeKey, pickTierText, ruleForLevel, spanOfLevel,
  tierForDistance, MAX_TREE_LEVEL, DEFAULT_TIER_RULES,
  type BuilderChapter, type ChainEntry, type SegmentText, type SummaryTier, type TierRule,
} from './builder.js'

/** 节点在当前上下文里的状态 */
export type NodeState = 'included' | 'locked' | 'over' | 'pinned' | 'excluded' | 'unused'

export interface TreeNode {
  key: string
  /** 0 = 单章，n = 越往上越粗 */
  level: number
  label: string
  startOrder: number
  endOrder: number
  chapterIds: string[]
  /** 覆盖的章数 */
  span: number
  tier: SummaryTier
  maxChars: number
  /** 该层实际会用到的文本（未使用的节点也会给出预览） */
  text: string
  source?: 'llm' | 'joined'
  state: NodeState
  chars: number
  /** 距离当前章几章（节点里最近的一章） */
  distance: number
  children: string[]
  excluded: boolean
  pinned: boolean
}

export interface TreeLevelInfo {
  level: number
  name: string
  /** 该层每个节点覆盖几章 */
  span: number
  nodes: TreeNode[]
}

export interface ContextTree {
  groupSize: number
  levels: TreeLevelInfo[]
  /** 链条实际占用的字数与预算 */
  usedChars: number
  budget: number
  /** 当前进入上下文的节点 key */
  includedKeys: string[]
  totalChapters: number
}

export interface TreeInput {
  /** 当前章之前的所有章节（按顺序） */
  prev: BuilderChapter[]
  budget: number
  groupSize: number
  segments?: SegmentText[]
  pinned?: string[]
  excluded?: string[]
  locked?: string[]
  rules?: TierRule[]
}

const LEVEL_NAMES = ['章节', '章段', '合并段', '大段']

/**
 * 构建前情的树状结构：叶子是每章的摘要，往上是各种粒度的多章压缩。
 * 节点状态来自真实的链条组装结果，因此界面上看到的颜色就是提词时实际用到的部分。
 */
export function buildContextTree(input: TreeInput): ContextTree {
  const rules = input.rules ?? DEFAULT_TIER_RULES
  const groupSize = Math.max(2, Math.min(10, Math.round(input.groupSize)))
  const excluded = new Set(input.excluded ?? [])
  const pinned = new Set(input.pinned ?? [])
  const locked = new Set(input.locked ?? [])

  const chain = buildHistoryChain(input.prev, {
    budget: input.budget,
    pinned: input.pinned,
    excluded: input.excluded,
    locked: input.locked,
    groupSize,
    segments: input.segments,
    rules,
  })

  // 链条条目 → 节点 key，用于标记「实际用到」
  const entryByKey = new Map<string, ChainEntry>()
  for (const e of chain.entries) {
    const prevEntry = entryByKey.get(e.nodeKey)
    // 同一节点可能有多条（如暂无摘要时逐章产出），保留信息量最大的那条
    if (!prevEntry || (e.included && !prevEntry.included)) entryByKey.set(e.nodeKey, e)
  }

  const segTextByBase = new Map<number, string>()
  const orderToIndex = new Map<number, number>()
  input.prev.forEach((ch, index) => {
    orderToIndex.set(ch.sortOrder ?? index + 1, index)
    if (ch.sortOrder === undefined) orderToIndex.set(index + 1, index)
  })
  for (const s of input.segments ?? []) {
    const idx = orderToIndex.get(s.startOrder)
    if (idx === undefined || !s.text.trim()) continue
    segTextByBase.set(Math.floor(idx / groupSize), s.text.trim())
  }

  const joinSegTexts = (startIndex: number, span: number, maxChars: number) => {
    const bases: number[] = []
    for (let i = startIndex; i < startIndex + span && i < input.prev.length; i++) {
      const b = Math.floor(i / groupSize)
      if (!bases.includes(b)) bases.push(b)
    }
    const texts = bases.map((b) => segTextByBase.get(b) ?? '')
    if (texts.length > 0 && texts.every((t) => t.length > 0)) {
      return { text: texts.join(' → ').slice(0, maxChars), source: 'llm' as const }
    }
    const joined = input.prev
      .slice(startIndex, Math.min(startIndex + span, input.prev.length))
      .map((c) => pickTierText(c, 'micro').trim())
      .filter((t) => t.length > 0)
      .join(' → ')
    return { text: joined.slice(0, maxChars), source: 'joined' as const }
  }

  const levels: TreeLevelInfo[] = []
  for (let level = 0; level <= MAX_TREE_LEVEL; level++) {
    const span = spanOfLevel(level, groupSize)
    const nodes: TreeNode[] = []
    for (let start = 0; start < input.prev.length; start += span) {
      const end = Math.min(start + span, input.prev.length) - 1
      const members = input.prev.slice(start, end + 1)
      if (members.length === 0) continue
      const startOrder = members[0]!.sortOrder ?? start + 1
      const endOrder = members[members.length - 1]!.sortOrder ?? end + 1
      const distance = input.prev.length - end
      const rule = level === 0 ? tierForDistance(distance, rules) : ruleForLevel(level, rules)
      const key = nodeKey(level, startOrder)

      let text = ''
      let source: 'llm' | 'joined' | undefined
      if (level === 0) {
        text = pickTierText(members[0]!, rule.tier).slice(0, rule.maxChars)
      } else {
        const r = joinSegTexts(start, span, rule.maxChars)
        text = r.text
        source = r.source
      }

      const entry = entryByKey.get(key)
      const allExcluded = members.every((m) => excluded.has(m.id))
      const anyPinned = members.some((m) => pinned.has(m.id))
      let state: NodeState = 'unused'
      if (locked.has(key) || (entry?.included && entry.locked)) state = 'locked'
      else if (allExcluded) state = 'excluded'
      else if (entry?.pinned) state = 'pinned'
      else if (entry?.included) state = 'included'
      else if (entry) state = 'over'

      nodes.push({
        key,
        level,
        label: level === 0 ? `第${startOrder}章` : `第${startOrder}–${endOrder}章`,
        startOrder,
        endOrder,
        chapterIds: members.map((m) => m.id),
        span: members.length,
        tier: rule.tier,
        maxChars: rule.maxChars,
        text,
        source,
        state,
        chars: entry?.chars ?? text.length,
        distance,
        children: [],
        excluded: allExcluded,
        pinned: anyPinned,
      })
    }

    // 子节点：下一层中被本节点完整包含的节点
    if (level > 0 && levels.length > 0) {
      const childLevel = levels[levels.length - 1]!
      for (const n of nodes) {
        for (const c of childLevel.nodes) {
          if (c.startOrder >= n.startOrder && c.endOrder <= n.endOrder) n.children.push(c.key)
        }
      }
    }

    levels.push({
      level,
      name: LEVEL_NAMES[level] ?? `第${level}层`,
      span,
      nodes,
    })
  }

  return {
    groupSize,
    levels,
    usedChars: chain.used,
    budget: input.budget,
    includedKeys: chain.entries.filter((e) => e.included).map((e) => e.nodeKey),
    totalChapters: input.prev.length,
  }
}

/** 树的层级名（供界面显示） */
export function levelName(level: number, groupSize: number): string {
  const span = spanOfLevel(level, groupSize)
  if (level === 0) return '章节'
  return `${span} 章一段`
}

export { levelForMerge }
