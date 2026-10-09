import { describe, expect, it } from 'vitest'
import {
  buildHistoryChain, tierForDistance, pickTierText, DEFAULT_TIER_RULES,
  type BuilderChapter,
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

  it('档位越远，单条字数上限越低', () => {
    const sizes = [1, 5, 20, 100].map((d) => tierForDistance(d).maxChars)
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!)
    }
  })

  it('缺层级时自动降级取用', () => {
    const only: BuilderChapter = { id: 'x', title: 'x', summary: '完整', summaryBrief: '', summaryMicro: '' }
    expect(pickTierText(only, 'brief')).toBe('完整')
    const briefOnly: BuilderChapter = { id: 'y', title: 'y', summary: '', summaryBrief: '一句话', summaryMicro: '' }
    expect(pickTierText(briefOnly, 'micro')).toBe('一句话')
  })
})

describe('前情链条组装', () => {
  it('40 章也能全部有机会进入上下文（预算充足时）', () => {
    const r = buildHistoryChain(chapters, { budget: 5000 })
    expect(r.entries.length).toBe(40)
    expect(r.entries.every((e) => e.included)).toBe(true)
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
    expect(r.entries.find((e) => e.chapterId === 'c1')!.included).toBe(false)
    expect(r.used).toBeLessThanOrEqual(100)
  })

  it('远处章节占的字数明显更少', () => {
    const r = buildHistoryChain(chapters, { budget: 5000 })
    const near = r.entries.find((e) => e.distance === 1)!.chars
    const far = r.entries.find((e) => e.distance === 40)!.chars
    expect(far).toBeLessThan(near / 5)
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
