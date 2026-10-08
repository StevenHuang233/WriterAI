import { describe, expect, it } from 'vitest'
import { fitBlocks, renderBlocks, type Block } from '../context/budget.js'

function block(key: string, text: string, trimOrder = 1, flex = true): Block {
  return { key, text, trimOrder, flex }
}

describe('fitBlocks', () => {
  it('预算内不裁剪', () => {
    const blocks = [block('a', 'x'.repeat(10)), block('b', 'y'.repeat(10))]
    const out = fitBlocks(blocks, 100)
    expect(out[0]!.text).toHaveLength(10)
    expect(out[1]!.text).toHaveLength(10)
  })

  it('按 trimOrder 升序裁剪：先动 order 小的', () => {
    const blocks = [
      block('important', 'A'.repeat(50), 5),
      block('cheap', 'B'.repeat(50), 1),
    ]
    const out = fitBlocks(blocks, 90)
    expect(out.find((b) => b.key === 'important')!.text).toHaveLength(50)
    expect(out.find((b) => b.key === 'cheap')!.text.length).toBeLessThan(50)
  })

  it('非 flex 块不被裁剪', () => {
    const blocks = [
      { key: 'fixed', text: 'F'.repeat(100), trimOrder: 0, flex: false },
      block('flex', 'B'.repeat(200), 1),
    ]
    const out = fitBlocks(blocks, 150)
    expect(out.find((b) => b.key === 'fixed')!.text).toHaveLength(100)
    expect(out.find((b) => b.key === 'flex')!.text.length).toBeLessThanOrEqual(200)
  })

  it('极端预算下 flex 块清空也不影响非 flex 块', () => {
    const blocks = [
      { key: 'fixed', text: 'F'.repeat(100), trimOrder: 99, flex: false },
      block('flex', 'B'.repeat(1000), 1),
    ]
    const out = fitBlocks(blocks, 100)
    expect(out.find((b) => b.key === 'fixed')!.text).toHaveLength(100)
    expect(out.find((b) => b.key === 'flex')!.text).toBe('')
  })
})

describe('renderBlocks', () => {
  it('空块被忽略，标题加【】', () => {
    const out = renderBlocks([
      { key: 'a', title: '故事简介', text: '内容', trimOrder: 1, flex: true },
      { key: 'b', title: '空', text: '', trimOrder: 1, flex: true },
      { key: 'c', text: '无标题内容', trimOrder: 1, flex: true },
    ])
    expect(out).toContain('【故事简介】\n内容')
    expect(out).not.toContain('【空】')
    expect(out).toContain('无标题内容')
  })
})
