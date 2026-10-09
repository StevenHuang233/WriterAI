import { describe, expect, it } from 'vitest'
import { parseMultiLevel } from '../services/summary.js'

const marked = `【完整】雨夜，林墨推门进屋，屋内漆黑。他按住剑柄没有出声，柜台后亮起火光，有人久久打量他。
【一句话】雨夜林墨进入酒馆，被认出听雨剑。
【极简】林墨入酒馆被认出`

describe('三层摘要解析', () => {
  it('按标记行拆出三个层级', () => {
    const r = parseMultiLevel(marked)
    expect(r).not.toBeNull()
    expect(r!.summary).toContain('雨夜，林墨推门进屋')
    expect(r!.brief).toContain('被认出听雨剑')
    expect(r!.micro).toBe('林墨入酒馆被认出')
  })

  it('标记前后可带多余空行或说明文字', () => {
    const raw = `好的，结果如下：\n\n${marked}\n\n以上。`
    const r = parseMultiLevel(raw)
    expect(r!.micro).toBe('林墨入酒馆被认出')
    expect(r!.summary).not.toContain('好的')
  })

  it('只有完整摘要时，下面两级自动截取', () => {
    const r = parseMultiLevel('【完整】这是一整段完整摘要内容，没有写另外两层。')
    expect(r!.summary).toBe('这是一整段完整摘要内容，没有写另外两层。')
    expect(r!.brief.length).toBeGreaterThan(0)
    expect(r!.micro.length).toBeGreaterThan(0)
    expect(r!.micro.length).toBeLessThanOrEqual(20)
  })

  it('完全没有标记时整段作为完整摘要', () => {
    const r = parseMultiLevel('模型只回了这么一整段话，没有任何标记。')
    expect(r!.summary).toContain('模型只回了这么一整段话')
  })

  it('空输入返回 null', () => {
    expect(parseMultiLevel('')).toBeNull()
    expect(parseMultiLevel('   ')).toBeNull()
    expect(parseMultiLevel(undefined as unknown as string)).toBeNull()
  })

  it('只有一句话时，完整摘要回退为该句', () => {
    const r = parseMultiLevel('【一句话】短短一句摘要')
    expect(r!.summary).toBe('短短一句摘要')
    expect(r!.brief).toBe('短短一句摘要')
  })
})
