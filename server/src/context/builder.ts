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
}

/** 分层压缩的档位：距离当前章越远，压缩越狠 */
export type SummaryTier = 'full' | 'brief' | 'micro'

export interface TierRule {
  /** 距离当前章多少章以内使用该档位 */
  within: number
  tier: SummaryTier
  /** 该档位下每条摘要的最大字数 */
  maxChars: number
}

export const DEFAULT_TIER_RULES: TierRule[] = [
  { within: 2, tier: 'full', maxChars: 320 },
  { within: 8, tier: 'brief', maxChars: 90 },
  { within: 30, tier: 'micro', maxChars: 34 },
  { within: Number.MAX_SAFE_INTEGER, tier: 'micro', maxChars: 22 },
]

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
}

/**
 * 组装前情链条：近详远略，尽量让全书都有机会进入上下文。
 * 从最近的一章往前填，直到用完预算；被固定的章节优先（用完整摘要）。
 */
export function buildHistoryChain(
  prev: BuilderChapter[],
  opts: {
    budget: number
    pinned?: string[]
    excluded?: string[]
    rules?: TierRule[]
    /** true 时只统计不拼文本（用于预览） */
    dry?: boolean
  },
): { entries: ChainEntry[]; text: string; used: number } {
  const pinned = new Set(opts.pinned ?? [])
  const excluded = new Set(opts.excluded ?? [])
  const rules = opts.rules ?? DEFAULT_TIER_RULES
  const entries: ChainEntry[] = []
  let used = 0

  // 距离：最后一章为 1
  const ordered = prev.map((ch, i) => ({ ch, distance: prev.length - i }))
  // 必须由近及远填充：否则预算会被最远的章节先占满
  const nearestFirst = [...ordered].reverse()

  // 1) 固定的章节优先（用完整摘要）
  for (const { ch, distance } of nearestFirst) {
    if (!pinned.has(ch.id)) continue
    if (excluded.has(ch.id)) continue
    let text = pickTierText(ch, 'full').slice(0, 320)
    if (!text.trim()) {
      entries.push({
        chapterId: ch.id, title: ch.title, order: ch.sortOrder ?? 0, distance, tier: 'full',
        text: '', chars: 0, pinned: true, included: false, reason: '暂无摘要',
      })
      continue
    }
    const chars = text.length
    if (used + chars > opts.budget) {
      entries.push({
        chapterId: ch.id, title: ch.title, order: ch.sortOrder ?? 0, distance, tier: 'full', text,
        chars, pinned: true, included: false, reason: '预算不足',
      })
      continue
    }
    used += chars
    entries.push({ chapterId: ch.id, title: ch.title, order: ch.sortOrder ?? 0, distance, tier: 'full', text, chars, pinned: true, included: true })
  }

  // 2) 其余按“由近及远”填充
  for (const { ch, distance } of nearestFirst) {
    if (pinned.has(ch.id)) continue
    if (excluded.has(ch.id)) {
      entries.push({
        chapterId: ch.id, title: ch.title, order: ch.sortOrder ?? 0, distance, tier: tierForDistance(distance, rules).tier,
        text: '', chars: 0, pinned: false, included: false, reason: '已手动排除',
      })
      continue
    }
    const rule = tierForDistance(distance, rules)
    let text = pickTierText(ch, rule.tier).slice(0, rule.maxChars)
    if (!text.trim()) {
      entries.push({
        chapterId: ch.id, title: ch.title, order: ch.sortOrder ?? 0, distance, tier: rule.tier,
        text: '', chars: 0, pinned: false, included: false, reason: '暂无摘要',
      })
      continue
    }
    const chars = text.length
    if (used + chars > opts.budget) {
      entries.push({
        chapterId: ch.id, title: ch.title, order: ch.sortOrder ?? 0, distance, tier: rule.tier, text,
        chars, pinned: false, included: false, reason: '预算不足（更远）',
      })
      continue
    }
    used += chars
    entries.push({ chapterId: ch.id, title: ch.title, order: ch.sortOrder ?? 0, distance, tier: rule.tier, text, chars, pinned: false, included: true })
  }

  // 输出按时间顺序（远 → 近）
  const included = [...entries].filter((e) => e.included).reverse()
  const text = included.map((e) => `第${e.order || e.distance}章《${e.title}》：${e.text}`).join('\n')
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
