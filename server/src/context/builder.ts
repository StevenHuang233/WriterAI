import { fitBlocks, renderBlocks, type Block } from './budget.js'
import { matchLore } from './lore-match.js'
import { suggestSystemPrompt } from '../llm/prompts.js'
import type { ChatMessage } from '../llm/client.js'

export type SuggestMode = 'inline' | 'continue'

export interface BuilderProject {
  synopsis: string
  globalSummary: string
  styleNote: string
}

export interface BuilderChapter {
  id: string
  title: string
  summary: string
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
}

export interface BuildResult {
  messages: ChatMessage[]
  usedLoreIds: string[]
  usedLoreNames: string[]
  totalChars: number
}

const INLINE = {
  synopsis: 300, alwaysOn: 800, global: 600, prevSummaries: 600,
  triggered: 1200, style: 300, suffix: 300, prefix: 1500, prevChapterCount: 2, triggerCount: 6,
}

const CONTINUE = {
  synopsis: 800, alwaysOn: 2000, global: 1500, prevSummaries: 2000,
  triggered: 3000, style: 500, suffix: 500, prefix: 3000, prevChapterCount: 5, triggerCount: 10,
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

  // 前几章摘要：从最近往前取，预算内为止
  const summaryParts: string[] = []
  let used = 0
  for (let i = prev.length - 1; i >= 0 && summaryParts.length < B.prevChapterCount; i--) {
    const c = prev[i]
    if (!c || !c.summary.trim()) continue
    const s = `第${i + 1}章《${c.title}》：${c.summary.trim()}`
    if (used + s.length > B.prevSummaries) break
    summaryParts.unshift(s)
    used += s.length
  }

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
    { key: 'prev', title: '前情摘要', text: summaryParts.join('\n'), trimOrder: 1, flex: true },
    { key: 'triggered', title: '相关设定', text: triggered.map(loreText).join('\n'), trimOrder: 5, flex: true },
    { key: 'style', title: '风格要求', text: input.project.styleNote.trim(), trimOrder: 99, flex: false },
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

  const budget = B.synopsis + B.alwaysOn + B.global + B.prevSummaries + B.triggered + B.style + B.suffix + B.prefix
  const fitted = fitBlocks(blocks, budget)
  const user = renderBlocks(fitted)

  const messages: ChatMessage[] = [
    { role: 'system', content: suggestSystemPrompt(input.mode) },
    { role: 'user', content: user },
  ]

  const usedLore = [...alwaysOn, ...triggered]
  return {
    messages,
    usedLoreIds: usedLore.map((l) => l.id),
    usedLoreNames: usedLore.map((l) => l.name),
    totalChars: user.length,
  }
}
