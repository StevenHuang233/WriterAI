import { fitBlocks, renderBlocks, type Block } from './budget.js'
import { matchLore } from './lore-match.js'
import { suggestSystemPrompt, type SuggestLength } from '../llm/prompts.js'
import type { ChatMessage } from '../llm/client.js'

export type SuggestMode = 'inline' | 'continue'

export interface BuilderProject {
  synopsis: string
  globalSummary: string
  styleNote: string
  /** 从正文自动总结的文风画像 */
  styleProfile?: string
}

export interface BuilderChapter {
  id: string
  title: string
  summary: string
  summaryBrief?: string
  summaryMicro?: string
  sortOrder?: number
}

export interface ContextSettingsInput {
  disabledBlocks?: string[]
  excludedChapters?: string[]
  pinnedChapters?: string[]
  /** 远段合段：每几章压缩成一段 */
  groupSize?: number
  /** 用户手动锁定「用这一层」的树节点 key */
  lockedNodes?: string[]
}

/** 分层压缩的档位：距离当前章越远，压缩越狠 */
export type SummaryTier = 'full' | 'brief' | 'micro'

export interface TierRule {
  /** 距离当前章多少章以内使用该档位 */
  within: number
  tier: SummaryTier
  /** 该档位下每条（一章或一段）的最大字数 */
  maxChars: number
  /**
   * 是否启用「合段压缩」：把连续的若干章（数量由 groupSize 决定）
   * 合并压缩成一条，而不是每章各占一条。远段单章上限会把剧情切碎，合段可以避免。
   */
  grouped?: boolean
  /** 再把相邻的几「段」合成一条（1 = 一段一条），距离越远合得越粗 */
  merge?: number
}

/** 远段默认每几章合成一段 */
export const DEFAULT_GROUP_SIZE = 3

export const DEFAULT_TIER_RULES: TierRule[] = [
  { within: 2, tier: 'full', maxChars: 320 },
  { within: 8, tier: 'brief', maxChars: 90 },
  { within: 22, tier: 'micro', maxChars: 130, grouped: true, merge: 1 },
  { within: 45, tier: 'micro', maxChars: 90, grouped: true, merge: 2 },
  // merge 取 1/2/4（而不是 1/2/3）：这样粗粒度节点正好由两个细粒度节点组成，能排成严格的树
  { within: Number.MAX_SAFE_INTEGER, tier: 'micro', maxChars: 60, grouped: true, merge: 4 },
]

/** 树的层级：0 = 单章，n = 每 groupSize × 2^(n-1) 章 */
export const MAX_TREE_LEVEL = 3

export function mergeForLevel(level: number): number {
  return level <= 0 ? 1 : 2 ** (level - 1)
}

export function levelForMerge(merge: number): number {
  if (merge <= 1) return 1
  return Math.round(Math.log2(merge)) + 1
}

/** 该层节点覆盖多少章 */
export function spanOfLevel(level: number, groupSize: number): number {
  return level <= 0 ? 1 : groupSize * mergeForLevel(level)
}

/** 树节点 key，如 L2:7 */
export function nodeKey(level: number, startOrder: number): string {
  return `L${level}:${startOrder}`
}

export function parseNodeKey(key: string): { level: number; startOrder: number } | null {
  const m = /^L(\d+):(\d+)$/.exec(key.trim())
  if (!m) return null
  const level = Number(m[1])
  const startOrder = Number(m[2])
  if (!Number.isFinite(level) || !Number.isFinite(startOrder)) return null
  if (level < 0 || level > MAX_TREE_LEVEL) return null
  return { level, startOrder }
}

/** 按层级找对应的档位规则（锁定节点时用） */
export function ruleForLevel(level: number, rules: TierRule[] = DEFAULT_TIER_RULES): TierRule {
  if (level <= 0) return tierForDistance(1, rules)
  const merge = mergeForLevel(level)
  const grouped = rules.filter((r) => r.grouped)
  return grouped.find((r) => (r.merge ?? 1) === merge) ?? grouped[grouped.length - 1] ?? rules[rules.length - 1]!
}

/** 合段文本的连接符 */
const SEG_JOIN = ' → '

/** 该档位下平均每一章能分到多少字（合段后单章占用大幅下降） */
export function charsPerChapter(rule: TierRule, groupSize: number = DEFAULT_GROUP_SIZE): number {
  const span = rule.grouped ? groupSize * (rule.merge ?? 1) : 1
  return rule.maxChars / span
}

/** 截断到 max 字，尽量在分隔符或标点处断开，避免把一句话截成半截 */
export function cutJoined(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const floor = Math.floor(max * 0.6)
  const sep = cut.lastIndexOf(SEG_JOIN)
  if (sep >= floor) return cut.slice(0, sep)
  let p = -1
  for (const ch of ['。', '；', '，']) {
    const i = cut.lastIndexOf(ch)
    if (i > p) p = i
  }
  if (p >= floor) return cut.slice(0, p + 1)
  return cut
}

export function tierForDistance(distance: number, rules: TierRule[] = DEFAULT_TIER_RULES): TierRule {
  for (const r of rules) {
    if (distance <= r.within) return r
  }
  return rules[rules.length - 1]!
}

export function pickTierText(ch: BuilderChapter, tier: SummaryTier): string {
  if (tier === 'full') return ch.summary || ch.summaryBrief || ch.summaryMicro || ''
  if (tier === 'brief') return ch.summaryBrief || ch.summary || ch.summaryMicro || ''
  return ch.summaryMicro || ch.summaryBrief || ch.summary || ''
}

export interface ChainSegment {
  /** 起始章节序号 */
  startOrder: number
  /** 结束章节序号 */
  endOrder: number
  /** 该段覆盖的章节 id */
  chapterIds: string[]
  /** llm = 预先用模型压缩好的合段摘要；joined = 用各章极简摘要拼接的兜底 */
  source: 'llm' | 'joined'
}

export interface ChainEntry {
  chapterId: string
  title: string
  /** 章节序号 */
  order: number
  /** 距离当前章几章（1 = 上一章） */
  distance: number
  tier: SummaryTier
  text: string
  chars: number
  pinned: boolean
  included: boolean
  /** 未纳入的原因 */
  reason?: string
  /** 合段条目（覆盖多章）时给出区间与来源 */
  segment?: ChainSegment
  /** 对应的树节点 key（L0:3 / L1:1 …），供结构图高亮 */
  nodeKey: string
  /** 该条目在树中的层级（0 = 单章） */
  level: number
  /** 用户手动锁定使用这一层 */
  locked?: boolean
}

/** 预先生成的合段摘要，按段的起始章节序号给出 */
export interface SegmentText {
  startOrder: number
  text: string
}

/**
 * 组装前情链条：近详远略，尽量让全书都有机会进入上下文。
 * - 近处：完整 / 一句话摘要，一章一条
 * - 远处：连续若干章压缩成一条（合段），越远合得越粗，避免远段被单章上限切碎
 * 从最近的一章往前填，直到用完预算；被固定的章节优先（用完整摘要）。
 */
export function buildHistoryChain(
  prev: BuilderChapter[],
  opts: {
    budget: number
    pinned?: string[]
    excluded?: string[]
    /** 用户手动锁定「用这一层」的树节点 key */
    locked?: string[]
    rules?: TierRule[]
    /** 远段每几章合成一段 */
    groupSize?: number
    /** 预先用模型生成的合段摘要 */
    segments?: SegmentText[]
    /** true 时只统计不拼文本（用于预览） */
    dry?: boolean
  },
): { entries: ChainEntry[]; text: string; used: number } {
  const pinned = new Set(opts.pinned ?? [])
  const excluded = new Set(opts.excluded ?? [])
  /** 已被固定或锁定的节点占用的章节，自动分组时跳过 */
  const assigned = new Set<string>()
  const rules = opts.rules ?? DEFAULT_TIER_RULES
  const groupSize = Math.max(2, Math.min(10, Math.round(opts.groupSize ?? DEFAULT_GROUP_SIZE)))
  const entries: ChainEntry[] = []
  let used = 0

  const orderOf = (ch: BuilderChapter, index: number) => ch.sortOrder ?? index + 1
  // 距离：最后一章为 1
  const ordered = prev.map((ch, index) => ({ ch, index, distance: prev.length - index }))
  // 必须由近及远填充：否则预算会被最远的章节先占满
  const nearestFirst = [...ordered].reverse()

  // 合段摘要：由“起始章节序号”定位到章段下标（floor(index / groupSize)）
  const segTextByBase = new Map<number, string>()
  const orderToIndex = new Map<number, number>()
  for (const { ch, index } of ordered) orderToIndex.set(orderOf(ch, index), index)
  for (const s of opts.segments ?? []) {
    const idx = orderToIndex.get(s.startOrder)
    if (idx === undefined) continue
    if (!s.text.trim()) continue
    segTextByBase.set(Math.floor(idx / groupSize), s.text.trim())
  }

  // 章段（每 groupSize 章一段）是合压的基本单位：先按段划分，再按段内最近一章的距离定档位，
  // 这样档位边界不会把段切开，预先生成的合段摘要才能整段用上
  const baseCount = new Map<number, number>()
  const baseMaxIndex = new Map<number, number>()
  for (const { index } of ordered) {
    const k = Math.floor(index / groupSize)
    baseCount.set(k, (baseCount.get(k) ?? 0) + 1)
    baseMaxIndex.set(k, Math.max(baseMaxIndex.get(k) ?? -1, index))
  }
  const baseRule = new Map<number, TierRule>()
  for (const [k, maxIndex] of baseMaxIndex) {
    baseRule.set(k, tierForDistance(ordered.length - maxIndex, rules))
  }

  // 1) 固定的章节优先（用完整摘要）
  for (const { ch, distance, index } of nearestFirst) {
    if (!pinned.has(ch.id)) continue
    if (excluded.has(ch.id)) continue
    const order = orderOf(ch, index)
    let text = pickTierText(ch, 'full').slice(0, 320)
    assigned.add(ch.id)
    if (!text.trim()) {
      entries.push({
        chapterId: ch.id, title: ch.title, order, distance, tier: 'full',
        text: '', chars: 0, pinned: true, included: false, reason: '暂无摘要',
        nodeKey: nodeKey(0, order), level: 0,
      })
      continue
    }
    const chars = text.length
    if (used + chars > opts.budget) {
      entries.push({
        chapterId: ch.id, title: ch.title, order, distance, tier: 'full', text,
        chars, pinned: true, included: false, reason: '预算不足',
        nodeKey: nodeKey(0, order), level: 0,
      })
      continue
    }
    used += chars
    entries.push({
      chapterId: ch.id, title: ch.title, order, distance, tier: 'full', text, chars,
      pinned: true, included: true, nodeKey: nodeKey(0, order), level: 0,
    })
  }

  // 2) 其余按“由近及远”填充，远处按章段合并
  interface Slot {
    ch: BuilderChapter
    index: number
    distance: number
    rule: TierRule
    key: string
  }
  let buf: Slot[] = []

  const pushEntry = (
    members: Slot[],
    rule: TierRule,
    text: string,
    chars: number,
    included: boolean,
    reason: string | undefined,
    source: ChainSegment['source'],
    level: number,
    locked = false,
  ) => {
    const orders = members.map((m) => orderOf(m.ch, m.index))
    const startOrder = orders[0]!
    const endOrder = orders[orders.length - 1]!
    const distance = Math.min(...members.map((m) => m.distance))
    if (members.length === 1 && level === 0) {
      const m = members[0]!
      entries.push({
        chapterId: m.ch.id, title: m.ch.title, order: startOrder, distance, tier: rule.tier,
        text, chars, pinned: false, included, reason,
        nodeKey: nodeKey(0, startOrder), level: 0, locked,
      })
      return
    }
    entries.push({
      chapterId: `seg:${startOrder}-${endOrder}`,
      title: `第${startOrder}–${endOrder}章`,
      order: startOrder,
      distance,
      tier: rule.tier,
      text,
      chars,
      pinned: false,
      included,
      reason,
      segment: { startOrder, endOrder, chapterIds: members.map((m) => m.ch.id), source },
      nodeKey: nodeKey(level, startOrder),
      level,
      locked,
    })
  }

  /** 计算一组章节的文本并产出条目（自动分组与手动锁定共用） */
  const emitGroup = (members: Slot[], rule: TierRule, levelOverride?: number) => {
    const sorted = [...members].sort((a, b) => a.index - b.index)
    if (sorted.length === 0) return
    const level = levelOverride ?? (rule.grouped ? levelForMerge(rule.merge ?? 1) : 0)

    // 合段文本：优先用预生成的压缩摘要（要求该段章节完整），否则用各章极简摘要拼接
    const baseKeys = [...new Set(sorted.map((m) => Math.floor(m.index / groupSize)))]
    const expected = baseKeys.reduce((s, k) => s + (baseCount.get(k) ?? 0), 0)
    const complete = sorted.length === expected
    let text = ''
    let source: ChainSegment['source'] = 'joined'
    if (rule.grouped && complete) {
      const texts = baseKeys.map((k) => segTextByBase.get(k) ?? '')
      if (texts.length > 0 && texts.every((t) => t.length > 0)) {
        text = cutJoined(texts.join(SEG_JOIN), rule.maxChars)
        source = 'llm'
      }
    }
    if (!text) {
      const joined = sorted
        .map((m) => pickTierText(m.ch, rule.tier === 'full' ? 'full' : 'micro').trim())
        .filter((t) => t.length > 0)
        .join(SEG_JOIN)
      text = cutJoined(joined, rule.maxChars)
    }

    if (!text.trim()) {
      for (const m of sorted) {
        entries.push({
          chapterId: m.ch.id, title: m.ch.title, order: orderOf(m.ch, m.index), distance: m.distance,
          tier: rule.tier, text: '', chars: 0, pinned: false, included: false, reason: '暂无摘要',
          nodeKey: nodeKey(0, orderOf(m.ch, m.index)), level: 0,
        })
      }
      return
    }
    const chars = text.length
    if (used + chars > opts.budget) {
      pushEntry(sorted, rule, text, chars, false, '预算不足（更远）', source, level, levelOverride !== undefined)
      return
    }
    used += chars
    pushEntry(sorted, rule, text, chars, true, undefined, source, level, levelOverride !== undefined)
  }

  const flush = () => {
    if (buf.length === 0) return
    const members = [...buf].sort((a, b) => a.index - b.index)
    buf = []
    // 段内最近的一章决定档位（越近越详细）
    emitGroup(members, members[members.length - 1]!.rule)
  }

  // 2) 用户锁定「用这一层」的节点：粗的优先占位
  const lockedNodes = (opts.locked ?? [])
    .map(parseNodeKey)
    .filter((n): n is { level: number; startOrder: number } => n !== null)
    .sort((a, b) => b.level - a.level)
  for (const node of lockedNodes) {
    const start = orderToIndex.get(node.startOrder)
    if (start === undefined) continue
    const rule = ruleForLevel(node.level, rules)
    const span = spanOfLevel(node.level, groupSize)
    const members: Slot[] = []
    for (let i = start; i < start + span && i < ordered.length; i++) {
      const it = ordered[i]!
      if (pinned.has(it.ch.id) || excluded.has(it.ch.id) || assigned.has(it.ch.id)) continue
      members.push({ ch: it.ch, index: it.index, distance: it.distance, rule, key: `locked:${nodeKey(node.level, node.startOrder)}` })
    }
    if (members.length === 0) continue
    for (const m of members) assigned.add(m.ch.id)
    emitGroup(members, rule, node.level)
  }

  // 3) 其余按“由近及远”填充，远处按章段合并
  for (const { ch, distance, index } of nearestFirst) {
    if (assigned.has(ch.id)) continue
    if (excluded.has(ch.id)) {
      entries.push({
        chapterId: ch.id, title: ch.title, order: orderOf(ch, index), distance,
        tier: tierForDistance(distance, rules).tier,
        text: '', chars: 0, pinned: false, included: false, reason: '已手动排除',
        nodeKey: nodeKey(0, orderOf(ch, index)), level: 0,
      })
      continue
    }
    const rule = baseRule.get(Math.floor(index / groupSize)) ?? tierForDistance(distance, rules)
    const key = rule.grouped
      ? `g:${Math.floor(Math.floor(index / groupSize) / (rule.merge ?? 1))}`
      : `s:${ch.id}`
    if (buf.length > 0 && buf[0]!.key !== key) flush()
    buf.push({ ch, index, distance, rule, key })
  }
  flush()

  // 输出按时间顺序（远 → 近）
  const included = [...entries].filter((e) => e.included).reverse()
  const text = included
    .map((e) => (e.segment ? `第${e.segment.startOrder}–${e.segment.endOrder}章：${e.text}` : `第${e.order}章《${e.title}》：${e.text}`))
    .join('\n')
  return { entries, text, used }
}

export interface BuilderLore {
  id: string
  type: string
  name: string
  aliases: string[]
  content: string
  currentState: string
  priority: number
  alwaysOn: boolean
  enabled: boolean
}

export interface BuildInput {
  project: BuilderProject
  /** 按顺序排列的全部章节 */
  chapters: BuilderChapter[]
  currentChapterId: string
  lore: BuilderLore[]
  /** 光标前文本（调用方已截取） */
  prefix: string
  /** 光标后文本（调用方已截取） */
  suffix: string
  mode: SuggestMode
  /** 期望的续写长度 */
  length?: SuggestLength
  /** 当前章细纲（让续写朝大纲推进） */
  outline?: string
  /** 出场人物之间的关系，如「林墨 — 掌柜：旧识，互有戒备」 */
  relations?: string[]
  /** 用户在界面里的上下文选择 */
  contextSettings?: ContextSettingsInput
  /** 预先生成的远段合段摘要 */
  segments?: SegmentText[]
}

export interface BuildResult {
  messages: ChatMessage[]
  usedLoreIds: string[]
  usedLoreNames: string[]
  totalChars: number
  /** 各上下文块实际字数，供界面显示链条 */
  blocks: { key: string; label: string; chars: number; enabled: boolean }[]
  /** 前情链条明细 */
  chain: ChainEntry[]
}

export function buildContextBlocks(input: BuildInput) {
  return buildSuggestMessages(input)
}

const INLINE = {
  synopsis: 300, alwaysOn: 800, global: 600, history: 1800,
  triggered: 1200, style: 300, suffix: 300, prefix: 1500, triggerCount: 6,
  outline: 300, relations: 400,
}

const CONTINUE = {
  synopsis: 800, alwaysOn: 2000, global: 1500, history: 3600,
  triggered: 3000, style: 500, suffix: 500, prefix: 3000, triggerCount: 10,
  outline: 600, relations: 600,
}

/** 各上下文块的展示名，供界面显示链条 */
export const BLOCK_LABELS: Record<string, string> = {
  synopsis: '故事简介',
  alwaysOn: '常驻设定',
  global: '全书梗概',
  prev: '前情链条',
  triggered: '相关设定',
  outline: '本章大纲',
  relations: '人物关系',
  style: '风格要求',
  suffix: '光标后文',
  prefix: '正文（光标前）',
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    character: '人物', location: '地点', item: '物品', faction: '势力', world: '世界观', other: '设定',
  }
  return map[type] ?? '设定'
}

function loreText(l: BuilderLore): string {
  const aliases = l.aliases.length > 0 ? `（别名：${l.aliases.join('、')}）` : ''
  const state = l.currentState.trim() ? ` 当前状态：${l.currentState.trim()}` : ''
  return `${typeLabel(l.type)}·${l.name}${aliases}：${l.content.trim()}${state}`
}

/**
 * prefix 末尾截取 max 字。若截断点在段落中间，且向前扩展到段落边界
 * 的额外长度在容忍范围内（20%），则从段落边界开始；否则硬截断。
 */
function cutPrefixFromParagraph(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.length - max
  const nl = text.lastIndexOf('\n', cut)
  if (nl >= 0) {
    const excess = cut - nl - 1
    if (excess <= Math.ceil(max * 0.2)) return text.slice(nl + 1)
  }
  return text.slice(cut)
}

export function buildSuggestMessages(input: BuildInput): BuildResult {
  const B = input.mode === 'inline' ? INLINE : CONTINUE

  const idx = input.chapters.findIndex((c) => c.id === input.currentChapterId)
  const prev = idx > 0 ? input.chapters.slice(0, idx) : []

  // 前情链条：近详远略，尽量让全书都有机会进入上下文
  const chain = buildHistoryChain(prev, {
    budget: B.history,
    pinned: input.contextSettings?.pinnedChapters,
    excluded: input.contextSettings?.excludedChapters,
    locked: input.contextSettings?.lockedNodes,
    groupSize: input.contextSettings?.groupSize,
    segments: input.segments,
  })

  // 关键词触发设定
  const scanText = input.prefix.slice(-2000) + input.suffix
  const triggered = matchLore(
    input.lore.map((l) => ({ ...l, aliases: l.aliases })),
    scanText,
    B.triggerCount,
  ).map((h) => input.lore.find((l) => l.id === h.id)).filter((l): l is BuilderLore => Boolean(l))

  const triggeredIds = new Set(triggered.map((l) => l.id))
  const alwaysOn = input.lore.filter((l) => l.enabled && l.alwaysOn && !triggeredIds.has(l.id))

  const suffixTrim = input.suffix.trim().slice(0, B.suffix)
  const prefixCut = cutPrefixFromParagraph(input.prefix, B.prefix)

  const blocks: Block[] = [
    { key: 'synopsis', title: '故事简介', text: input.project.synopsis.trim(), trimOrder: 4, flex: true },
    { key: 'alwaysOn', title: '常驻设定', text: alwaysOn.map(loreText).join('\n'), trimOrder: 3, flex: true },
    { key: 'global', title: '全书梗概', text: input.project.globalSummary.trim(), trimOrder: 2, flex: true },
    { key: 'prev', title: '前情链条（近详远略）', text: chain.text, trimOrder: 1, flex: true },
    { key: 'triggered', title: '相关设定', text: triggered.map(loreText).join('\n'), trimOrder: 5, flex: true },
    { key: 'outline', title: '本章大纲', text: input.outline?.trim() ?? '', trimOrder: 6, flex: true },
    {
      key: 'relations',
      title: '人物关系',
      text: (input.relations ?? []).join('\n'),
      trimOrder: 7,
      flex: true,
    },
    {
      key: 'style',
      title: '风格要求',
      // 手写指令在前，自动总结的文风画像在后（两者都会影响生成）
      text: [input.project.styleNote.trim(), input.project.styleProfile?.trim()]
        .filter((s) => s)
        .join('\n'),
      trimOrder: 99,
      flex: false,
    },
    {
      key: 'suffix',
      title: '光标后文',
      text: suffixTrim ? `${suffixTrim}\n（【正文】的续写需要能自然衔接到以上光标后文）` : '',
      trimOrder: 99,
      flex: false,
    },
    {
      key: 'prefix',
      title: '正文',
      text: `${prefixCut}\n（【正文】结尾即光标位置，从此处开始续写）`,
      trimOrder: 99,
      flex: false,
    },
  ]

  const budget =
    B.synopsis + B.alwaysOn + B.global + B.history + B.triggered + B.outline + B.relations +
    B.style + B.suffix + B.prefix

  // 用户在界面里关掉的块不进入上下文
  const enabled = blocks.filter((b) => !input.contextSettings?.disabledBlocks?.includes(b.key))
  const fitted = fitBlocks(enabled, budget)
  const user = renderBlocks(fitted)

  const messages: ChatMessage[] = [
    { role: 'system', content: suggestSystemPrompt(input.mode, input.length ?? 'medium') },
    { role: 'user', content: user },
  ]

  const usedLore = [...alwaysOn, ...triggered]
  const disabled = new Set(input.contextSettings?.disabledBlocks ?? [])
  return {
    messages,
    usedLoreIds: usedLore.map((l) => l.id),
    usedLoreNames: usedLore.map((l) => l.name),
    totalChars: user.length,
    blocks: blocks.map((b) => ({
      key: b.key,
      label: BLOCK_LABELS[b.key] ?? b.key,
      chars: fitted.find((f) => f.key === b.key)?.text.trim().length ?? 0,
      enabled: !disabled.has(b.key),
    })),
    chain: chain.entries,
  }
}
