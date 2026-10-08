import { describe, expect, it } from 'vitest'
import { countInText, replaceInText, searchChapters } from '../services/search.js'
import { parseImport } from '../services/import.js'

const chapters = [
  { id: 'c1', title: '第一章', content: '林墨走进酒馆。林墨按住剑柄。' },
  { id: 'c2', title: '第二章', content: '青石镇的雨停了，林墨没有来。' },
]

describe('搜索', () => {
  it('跨章节统计匹配数并给出上下文', () => {
    const r = searchChapters(chapters, '林墨')
    expect(r.total).toBe(3)
    expect(r.matches).toHaveLength(3)
    expect(r.matches[0]!.chapterId).toBe('c1')
    expect(r.matches[0]!.index).toBe(0)
    expect(r.matches[0]!.preview).toContain('林墨')
  })

  it('空查询不报错', () => {
    expect(searchChapters(chapters, '').total).toBe(0)
  })

  it('找不到时返回 0', () => {
    expect(searchChapters(chapters, '不存在的人').total).toBe(0)
  })

  it('按出现次数定位（用于跳转）', () => {
    const r = searchChapters(chapters, '林墨')
    // “林墨走进酒馆。林墨按住剑柄。”中第二个“林墨”起始于索引 7
    expect(r.matches[1]!.index).toBe(7)
    expect(r.matches[2]!.chapterId).toBe('c2')
  })
})

describe('替换', () => {
  it('统计出现次数', () => {
    expect(countInText('aaa', 'a')).toBe(3)
    expect(countInText('', 'a')).toBe(0)
    expect(countInText('abc', '')).toBe(0)
  })

  it('全部替换并计数', () => {
    const r = replaceInText('林墨和林墨', '林墨', '沈青')
    expect(r.text).toBe('沈青和沈青')
    expect(r.count).toBe(2)
  })

  it('替换为空串等于删除', () => {
    expect(replaceInText('甲乙丙', '乙', '').text).toBe('甲丙')
  })

  it('无匹配时原样返回', () => {
    const r = replaceInText('abc', 'x', 'y')
    expect(r.text).toBe('abc')
    expect(r.count).toBe(0)
  })
})

describe('导入解析', () => {
  it('按 Markdown 标题分章', () => {
    const md = '# 第一章\n正文一\n## 第二节\n正文二\n'
    const r = parseImport(md, 'md-heading', '导入')
    expect(r).toHaveLength(2)
    expect(r[0]!.title).toBe('第一章')
    expect(r[0]!.content).toBe('正文一')
    expect(r[1]!.title).toBe('第二节')
  })

  it('按“第X章”标题分章（含中文数字）', () => {
    const txt = '第一章 雨夜\n雨下了整夜。\n第二章 酒馆\n他推开门。\n'
    const r = parseImport(txt, 'chapter-regex', '导入')
    expect(r).toHaveLength(2)
    expect(r[0]!.title).toBe('第一章 雨夜')
    expect(r[0]!.content).toBe('雨下了整夜。')
  })

  it('整篇作为一章', () => {
    const r = parseImport('一段\n两段', 'single', '全文')
    expect(r).toHaveLength(1)
    expect(r[0]!.title).toBe('全文')
  })

  it('没有标题时整体作为一章', () => {
    const r = parseImport('没有标题的正文', 'md-heading', '导入章节')
    expect(r).toHaveLength(1)
    expect(r[0]!.content).toBe('没有标题的正文')
  })
})
