import { describe, expect, it } from 'vitest'
import { buildContextTree } from '../context/tree.js'
import {
  nodeKey, parseNodeKey, spanOfLevel, mergeForLevel, levelForMerge,
  type BuilderChapter, type SegmentText,
} from '../context/builder.js'

function ch(id: string, n: number): BuilderChapter {
  return {
    id,
    title: `第${n}章`,
    summary: `第${n}章完整摘要：`.padEnd(50, '详'),
    summaryBrief: `第${n}章一句话摘要`.padEnd(26, '简'),
    summaryMicro: `第${n}章极简`,
    sortOrder: n,
  }
}

const chapters = Array.from({ length: 24 }, (_, i) => ch(`c${i + 1}`, i + 1))
const segments: SegmentText[] = Array.from({ length: 8 }, (_, i) => ({
  startOrder: i * 3 + 1,
  text: `第${i * 3 + 1}-${i * 3 + 3}章压缩`,
}))

const base = {
  prev: chapters,
  budget: 3000,
  groupSize: 3,
  segments,
}

describe('结构图层级', () => {
  it('层级跨度按 1/2/4 倍递增，能严格嵌套成树', () => {
    expect(spanOfLevel(0, 3)).toBe(1)
    expect(spanOfLevel(1, 3)).toBe(3)
    expect(spanOfLevel(2, 3)).toBe(6)
    expect(spanOfLevel(3, 3)).toBe(12)
    expect(mergeForLevel(3)).toBe(4)
    expect(levelForMerge(4)).toBe(3)
  })

  it('节点 key 可解析', () => {
    expect(nodeKey(2, 7)).toBe('L2:7')
    expect(parseNodeKey('L2:7')).toEqual({ level: 2, startOrder: 7 })
    expect(parseNodeKey('x')).toBeNull()
  })
})

describe('前情结构图', () => {
  it('叶子是每章，往上依次是 3/6/12 章的合并', () => {
    const t = buildContextTree(base)
    expect(t.levels.length).toBe(4)
    expect(t.levels[0]!.nodes.length).toBe(24)
    expect(t.levels[1]!.span).toBe(3)
    expect(t.levels[2]!.span).toBe(6)
    expect(t.levels[3]!.span).toBe(12)
    expect(t.totalChapters).toBe(24)
  })

  it('父子关系严格包含', () => {
    const t = buildContextTree(base)
    for (let level = 1; level < t.levels.length; level++) {
      const parents = t.levels[level]!
      const children = t.levels[level - 1]!
      for (const p of parents.nodes) {
        expect(p.children.length).toBeGreaterThan(0)
        for (const key of p.children) {
          const c = children.nodes.find((n) => n.key === key)!
          expect(c.startOrder).toBeGreaterThanOrEqual(p.startOrder)
          expect(c.endOrder).toBeLessThanOrEqual(p.endOrder)
        }
      }
    }
  })

  it('被链条实际使用的节点标记为 included，且总数与链条一致', () => {
    const t = buildContextTree(base)
    const included = t.levels.flatMap((l) => l.nodes.filter((n) => n.state === 'included'))
    expect(included.length).toBeGreaterThan(0)
    expect(included.length).toBe(t.includedKeys.length)
    // 近处用单章，远处用合段
    expect(included.some((n) => n.level === 0)).toBe(true)
    expect(included.some((n) => n.level > 0)).toBe(true)
  })

  it('预算不足的远处节点标记为 over', () => {
    const t = buildContextTree({ ...base, budget: 120 })
    const over = t.levels.flatMap((l) => l.nodes.filter((n) => n.state === 'over'))
    expect(over.length).toBeGreaterThan(0)
    expect(t.usedChars).toBeLessThanOrEqual(120)
  })

  it('排除某章后，覆盖它的节点标记为 excluded', () => {
    const t = buildContextTree({ ...base, excluded: ['c1', 'c2', 'c3'] })
    const node = t.levels[1]!.nodes.find((n) => n.startOrder === 1)!
    expect(node.state).toBe('excluded')
  })

  it('固定某章后，该章节点标记为 pinned', () => {
    const t = buildContextTree({ ...base, pinned: ['c20'] })
    const node = t.levels[0]!.nodes.find((n) => n.startOrder === 20)!
    expect(node.state).toBe('pinned')
  })

  it('锁定某个节点后，它进入上下文并标记为 locked', () => {
    const before = buildContextTree(base)
    const beforeKey = before.levels[1]!.nodes[0]!.key
    expect(before.levels[1]!.nodes[0]!.state).not.toBe('locked')

    const t = buildContextTree({ ...base, locked: [beforeKey] })
    const node = t.levels[1]!.nodes[0]!
    expect(node.state).toBe('locked')
    expect(t.includedKeys).toContain(beforeKey)
  })

  it('锁定粗层会吃掉细层的名额（同一批章节只出现一次）', () => {
    const coarse = buildContextTree(base).levels[3]!.nodes[0]!.key
    const t = buildContextTree({ ...base, locked: [coarse] })
    const used = t.levels.flatMap((l) => l.nodes.filter((n) => n.state === 'included' || n.state === 'locked'))
    const covered = new Set<string>()
    for (const n of used) for (const id of n.chapterIds) covered.add(id)
    // 一个章节只应被一个条目占用
    let sum = 0
    for (const n of used) sum += n.chapterIds.length
    expect(sum).toBe(covered.size)
  })
})
