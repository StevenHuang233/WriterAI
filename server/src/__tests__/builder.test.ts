import { describe, expect, it } from 'vitest'
import { buildSuggestMessages } from '../context/builder.js'
import type { BuildInput } from '../context/builder.js'

function makeInput(partial: Partial<BuildInput> = {}): BuildInput {
  return {
    project: { synopsis: '一个修仙的故事', globalSummary: '主角已出山', styleNote: '第三人称，冷峻文风' },
    chapters: [
      { id: 'c1', title: '第一章', summary: '主角下山。' },
      { id: 'c2', title: '第二章', summary: '主角遇到林墨。' },
      { id: 'c3', title: '第三章', summary: '' },
    ],
    currentChapterId: 'c3',
    lore: [
      { id: 'l1', type: 'character', name: '林墨', aliases: ['小墨'], content: '主角的师兄', currentState: '在青石镇', priority: 0, alwaysOn: false, enabled: true },
      { id: 'l2', type: 'location', name: '青石镇', aliases: [], content: '小镇', currentState: '', priority: 0, alwaysOn: true, enabled: true },
      { id: 'l3', type: 'character', name: '王五', aliases: [], content: '路人', currentState: '', priority: 0, alwaysOn: false, enabled: true },
    ],
    prefix: '林墨推开酒馆的门，',
    suffix: '他环顾四周。',
    mode: 'inline',
    ...partial,
  }
}

describe('buildSuggestMessages', () => {
  it('生成 system + user 两条消息，user 包含各区块', () => {
    const r = buildSuggestMessages(makeInput())
    expect(r.messages).toHaveLength(2)
    expect(r.messages[0]!.role).toBe('system')
    const user = r.messages[1]!.content
    expect(user).toContain('【故事简介】')
    expect(user).toContain('【全书梗概】')
    expect(user).toContain('【前情链条')
    expect(user).toContain('【正文】')
  })

  it('触发设定：仅命中的条目进入相关设定，常驻条目单独成块', () => {
    const r = buildSuggestMessages(makeInput())
    expect(r.usedLoreNames).toContain('林墨')
    expect(r.usedLoreNames).toContain('青石镇')
    expect(r.usedLoreNames).not.toContain('王五')
    const user = r.messages[1]!.content
    expect(user).toContain('【相关设定】')
    expect(user).toContain('【常驻设定】')
  })

  it('前情摘要只包含当前章之前的章节', () => {
    const r = buildSuggestMessages(makeInput())
    const user = r.messages[1]!.content
    expect(user).toContain('第一章')
    expect(user).toContain('第二章')
    // 第二章是当前章（c3 当前，前两章都进摘要），把当前章设为 c2 验证排除
    const r2 = buildSuggestMessages(makeInput({ currentChapterId: 'c2' }))
    const user2 = r2.messages[1]!.content
    expect(user2).toContain('第一章')
    expect(user2).not.toContain('第二章')
  })

  it('prefix 截断到预算内且尽量从段落边界开始', () => {
    // 三段共 2701 字，超过 inline 的 prefix 预算 1500
    const longPrefix = `${'甲'.repeat(1000)}\n${'乙'.repeat(1200)}\n${'丙'.repeat(500)}`
    const r = buildSuggestMessages(makeInput({ prefix: longPrefix }))
    const m = r.messages[1]!.content.match(/【正文】\n([\s\S]+?)\n（【正文】结尾即光标位置/)
    expect(m).toBeTruthy()
    const body = m![1]!
    // 截断点在乙段内，向前扩展到段落边界（超出量在容忍范围内）
    expect(body[0]).toBe('乙')
    expect(body.length).toBeGreaterThan(1500)
    expect(body.length).toBeLessThanOrEqual(1500 + 1500 * 0.2 + 10)
    // 未超过预算的 prefix 原样保留
    const short = makeInput({ prefix: '短正文' })
    expect(buildSuggestMessages(short).messages[1]!.content).toContain('【正文】\n短正文')
  })

  it('continue 模式使用不同的系统提示', () => {
    const inline = buildSuggestMessages(makeInput({ mode: 'inline' }))
    const cont = buildSuggestMessages(makeInput({ mode: 'continue' }))
    expect(inline.messages[0]!.content).not.toBe(cont.messages[0]!.content)
  })

  it('空设定时不输出空块标题', () => {
    const r = buildSuggestMessages(makeInput({ lore: [] }))
    expect(r.messages[1]!.content).not.toContain('【常驻设定】')
    expect(r.messages[1]!.content).not.toContain('【相关设定】')
  })
})
