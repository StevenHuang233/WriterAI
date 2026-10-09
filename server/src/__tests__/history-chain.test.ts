import { describe, expect, it } from 'vitest'
import {
  buildHistoryChain, charsPerChapter, cutJoined, tierForDistance, pickTierText,
  DEFAULT_TIER_RULES, DEFAULT_GROUP_SIZE,
  type BuilderChapter, type ChainEntry, type SegmentText,
} from '../context/builder.js'

function ch(id: string, title: string, n: number): BuilderChapter {
  return {
    id,
    title,
    summary: `第${n}章完整摘要：`.padEnd(60, '详'),
    summaryBrief: `第${n}章一句话摘要`.padEnd(30, '简'),
    summaryMicro: `第${n}章极简`,
    sortOrder: n,
  }
}

const chapters = Array.from({ length: 40 }, (_, i) => ch(`c${i + 1}`, `第${i + 1}章`, i + 1))

describe('分层档位', () => {
  it('近两章用完整摘要', () => {
    expect(tierForDistance(1).tier).toBe('full')
    expect(tierForDistance(2).tier).toBe('full')
  })

  it('3~8 章用一句话摘要', () => {
    expect(tierForDistance(3).tier).toBe('brief')
    expect(tierForDistance(8).tier).toBe('brief')
  })

  it('9 章以外用极简摘要', () => {
    expect(tierForDistance(9).tier).toBe('micro')
    expect(tierForDistance(100).tier).toBe('micro')
  })

  it('档位越远，平均每章分到的字数越少', () => {
    const per = [1, 5, 20, 30, 100].map((d) => charsPerChapter(tierForDistance(d), DEFAULT_GROUP_SIZE))
    for (let i = 1; i < per.length; i++) {
      expect(per[i]!).toBeLessThan(per[i - 1]!)
    }
  })

  it('远处档位启用合段，越远合得越粗', () => {
    expect(tierForDistance(2).grouped).toBeFalsy()
    expect(tierForDistance(20).grouped).toBe(true)
    expect(tierForDistance(20).merge).toBe(1)
    expect(tierForDistance(30).merge).toBe(2)
    // 1/2/4 而不是 1/2/3：粗层正好由两个细层组成，能排成严格的树
    expect(tierForDistance(100).merge).toBe(4)
  })

  it('缺层级时自动降级取用', () => {
    const only: BuilderChapter = { id: 'x', title: 'x', summary: '完整', summaryBrief: '', summaryMicro: '' }
    expect(pickTierText(only, 'brief')).toBe('完整')
    const briefOnly: BuilderChapter = { id: 'y', title: 'y', summary: '', summaryBrief: '一句话', summaryMicro: '' }
    expect(pickTierText(briefOnly, 'micro')).toBe('一句话')
  })
})

function coveredChapters(entries: { included: boolean; segment?: { chapterIds: string[] } }[]): number {
  return entries
    .filter((e) => e.included)
    .reduce((s, e) => s + (e.segment ? e.segment.chapterIds.length : 1), 0)
}

describe('前情链条组装', () => {
  it('40 章也能全部有机会进入上下文（预算充足时）', () => {
    const r = buildHistoryChain(chapters, { budget: 5000 })
    expect(r.entries.every((e) => e.included)).toBe(true)
    // 远处多章合并成一条，条目数远少于章数，但覆盖的章数仍是全部
    expect(r.entries.length).toBeLessThan(40)
    expect(coveredChapters(r.entries)).toBe(40)
    expect(r.used).toBeLessThanOrEqual(5000)
  })

  it('预算不足时优先保留近处章节', () => {
    const r = buildHistoryChain(chapters, { budget: 100 })
    const inc = r.entries.filter((e) => e.included)
    expect(inc.length).toBeLessThan(40)
    expect(inc.length).toBeGreaterThan(0)
    // 最近的章节一定在里面
    expect(r.entries.find((e) => e.chapterId === 'c40')!.included).toBe(true)
    // 最远的被挤掉
    expect(r.entries.find((e) => e.segment?.chapterIds.includes('c1'))!.included).toBe(false)
    expect(r.used).toBeLessThanOrEqual(100)
  })

  it('远处章节平均每章占的字数明显更少', () => {
    const r = buildHistoryChain(chapters, { budget: 5000 })
    const near = r.entries.find((e) => e.distance === 1)!
    const far = r.entries.find((e) => e.segment?.chapterIds.includes('c1'))!
    const nearPer = near.chars
    const farPer = far.chars / (far.segment?.chapterIds.length ?? 1)
    expect(farPer).toBeLessThan(nearPer / 5)
  })

  it('被排除的章节不进入上下文', () => {
    const r = buildHistoryChain(chapters, { budget: 5000, excluded: ['c40', 'c39'] })
    expect(r.entries.find((e) => e.chapterId === 'c40')!.included).toBe(false)
    expect(r.entries.find((e) => e.chapterId === 'c40')!.reason).toContain('排除')
  })

  it('固定的章节始终以完整摘要进入，且优先占位', () => {
    // 预算很小，固定最远的一章：它应该仍被纳入（用完整摘要）
    const r = buildHistoryChain(chapters, { budget: 200, pinned: ['c1'] })
    const pinnedEntry = r.entries.find((e) => e.chapterId === 'c1')!
    expect(pinnedEntry.included).toBe(true)
    expect(pinnedEntry.tier).toBe('full')
  })

  it('输出文本按时间顺序（远 → 近）', () => {
    const r = buildHistoryChain(chapters.slice(0, 5), { budget: 5000 })
    const lines = r.text.split('\n')
    expect(lines[0]).toContain('第1章')
    expect(lines[lines.length - 1]).toContain('第5章')
  })

  it('没有摘要的章节被标记原因而不是报错', () => {
    const noSummary: BuilderChapter[] = [
      { id: 'a', title: '无摘要章', summary: '', summaryBrief: '', summaryMicro: '' },
    ]
    const r = buildHistoryChain(noSummary, { budget: 1000 })
    expect(r.entries[0]!.included).toBe(false)
    expect(r.entries[0]!.reason).toContain('暂无摘要')
    expect(r.text).toBe('')
  })

  it('默认档位规则覆盖全部距离', () => {
    expect(DEFAULT_TIER_RULES[DEFAULT_TIER_RULES.length - 1]!.within).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('远段合段压缩', () => {
  const segTexts: SegmentText[] = [
    { startOrder: 1, text: '第一段压缩' },
    { startOrder: 4, text: '第二段压缩' },
    { startOrder: 7, text: '第三段压缩' },
    { startOrder: 10, text: '第四段压缩' },
    { startOrder: 13, text: '第五段压缩' },
    { startOrder: 16, text: '第六段压缩' },
  ]

  /** 合段条目不再以单章 id 出现，按它覆盖的章节查找 */
  const seg = (r: { entries: ChainEntry[] }, id = 'c1') =>
    r.entries.find((e) => e.segment?.chapterIds.includes(id))

  it('远处多章合并成一条，标题给出章节区间', () => {
    const r = buildHistoryChain(chapters, { budget: 5000 })
    const far = seg(r)!
    expect(far.segment).toBeTruthy()
    expect(far.segment!.chapterIds.length).toBeGreaterThan(1)
    expect(far.title).toBe(`第1–${far.segment!.endOrder}章`)
  })

  it('近处仍然一章一条', () => {
    const r = buildHistoryChain(chapters, { budget: 5000 })
    const near = r.entries.filter((e) => e.distance <= 8)
    expect(near.every((e) => !e.segment)).toBe(true)
  })

  it('有预生成的合段摘要时优先使用它', () => {
    const r = buildHistoryChain(chapters, { budget: 5000, segments: segTexts })
    const far = seg(r)!
    expect(far.segment!.source).toBe('llm')
    expect(far.text).toContain('第一段压缩')
    expect(far.text).toContain('第二段压缩')
  })

  it('段内有章节被排除时回退为各章极简摘要拼接', () => {
    const r = buildHistoryChain(chapters, { budget: 5000, segments: segTexts, excluded: ['c2'] })
    const far = seg(r)!
    expect(far.segment!.source).toBe('joined')
    expect(far.segment!.chapterIds).not.toContain('c2')
  })

  it('段内有章节被固定时，该章单独出场', () => {
    const r = buildHistoryChain(chapters, { budget: 5000, segments: segTexts, pinned: ['c1'] })
    const pinnedEntry = r.entries.find((e) => e.chapterId === 'c1')!
    expect(pinnedEntry.included).toBe(true)
    expect(pinnedEntry.tier).toBe('full')
    const far = seg(r, 'c2')!
    expect(far.segment!.chapterIds).not.toContain('c1')
    expect(far.segment!.source).toBe('joined')
  })

  it('合段粒度越大，条目越少', () => {
    const small = buildHistoryChain(chapters, { budget: 5000, groupSize: 3 })
    const large = buildHistoryChain(chapters, { budget: 5000, groupSize: 8 })
    expect(large.entries.length).toBeLessThan(small.entries.length)
    expect(coveredChapters(large.entries)).toBe(40)
  })

  it('没有预生成摘要时也能用极简摘要拼出合段', () => {
    const r = buildHistoryChain(chapters, { budget: 5000 })
    const far = seg(r)!
    expect(far.text).toContain('→')
    expect(far.chars).toBeGreaterThan(0)
  })

  it('截断时尽量在分隔符或标点处断开', () => {
    expect(cutJoined('甲 → 乙 → 丙', 8)).toBe('甲 → 乙')
    expect(cutJoined('一二三四，五六七八九十', 5)).toBe('一二三四，')
    expect(cutJoined('短句', 10)).toBe('短句')
  })
})
