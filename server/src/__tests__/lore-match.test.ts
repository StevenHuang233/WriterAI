import { describe, expect, it } from 'vitest'
import { matchLore } from '../context/lore-match.js'
import type { LoreLike } from '../context/lore-match.js'

function entry(partial: Partial<LoreLike> & { id: string; name: string }): LoreLike {
  return { aliases: [], priority: 0, alwaysOn: false, enabled: true, ...partial }
}

describe('matchLore', () => {
  it('按名称和别名匹配', () => {
    const entries = [
      entry({ id: '1', name: '林墨', aliases: ['小墨', '墨哥'] }),
      entry({ id: '2', name: '青石镇' }),
    ]
    const hits = matchLore(entries, '小墨走在街上，远处的青石镇灯火通明', 10)
    expect(hits.map((h) => h.id).sort()).toEqual(['1', '2'])
    expect(hits.find((h) => h.id === '1')?.hit).toBe('小墨')
  })

  it('长名优先：张三丰不被张三抢走', () => {
    const entries = [
      entry({ id: '1', name: '张三' }),
      entry({ id: '2', name: '张三丰' }),
    ]
    const hits = matchLore(entries, '张三丰出山', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.name).toBe('张三丰')
  })

  it('单字名不参与匹配', () => {
    const entries = [entry({ id: '1', name: '墨', aliases: ['七'] })]
    expect(matchLore(entries, '墨与七', 10)).toHaveLength(0)
  })

  it('未启用的条目被跳过', () => {
    const entries = [entry({ id: '1', name: '林墨', enabled: false })]
    expect(matchLore(entries, '林墨来了', 10)).toHaveLength(0)
  })

  it('priority 高者优先，位置越靠后越优先', () => {
    const entries = [
      entry({ id: '1', name: '甲某', aliases: [] , priority: 0 }),
      entry({ id: '2', name: '乙某', aliases: [], priority: 10 }),
    ]
    const hits = matchLore(entries, '甲某在前面出现过，乙某在后面', 1)
    expect(hits[0]!.id).toBe('2')
  })

  it('限制返回数量', () => {
    const entries = [1, 2, 3, 4, 5].map((i) => entry({ id: String(i), name: `人物${i}` }))
    const hits = matchLore(entries, '人物1人物2人物3人物4人物5', 2)
    expect(hits).toHaveLength(2)
    // 人物5 位置最靠后，应保留
    expect(hits.some((h) => h.name === '人物5')).toBe(true)
  })
})
