import { describe, expect, it } from 'vitest'
import { cnNumeral, formatChapterTitle, splitLongParagraphs } from '../services/export.js'

describe('中文数字序号', () => {
  it('基础数字', () => {
    expect(cnNumeral(1)).toBe('一')
    expect(cnNumeral(9)).toBe('九')
    expect(cnNumeral(10)).toBe('十')
    expect(cnNumeral(11)).toBe('十一')
    expect(cnNumeral(20)).toBe('二十')
    expect(cnNumeral(21)).toBe('二十一')
    expect(cnNumeral(99)).toBe('九十九')
  })

  it('三位数与零的处理', () => {
    expect(cnNumeral(100)).toBe('一百')
    expect(cnNumeral(101)).toBe('一百零一')
    expect(cnNumeral(110)).toBe('一百一十')
    expect(cnNumeral(125)).toBe('一百二十五')
  })

  it('四位数', () => {
    expect(cnNumeral(1000)).toBe('一千')
    expect(cnNumeral(1001)).toBe('一千零一')
    expect(cnNumeral(1234)).toBe('一千二百三十四')
  })
})

describe('章节标题模板', () => {
  it('中文数字模板', () => {
    expect(formatChapterTitle('雨夜', 3, 'cn')).toBe('第三章 雨夜')
  })

  it('阿拉伯数字模板', () => {
    expect(formatChapterTitle('雨夜', 12, 'num')).toBe('第12章 雨夜')
  })

  it('数字加点模板', () => {
    expect(formatChapterTitle('雨夜', 2, 'dot')).toBe('2. 雨夜')
  })

  it('只用标题', () => {
    expect(formatChapterTitle('雨夜', 2, 'plain')).toBe('雨夜')
  })

  it('标题本身就是“第一章”时不重复', () => {
    expect(formatChapterTitle('第一章', 1, 'cn')).toBe('第一章')
    expect(formatChapterTitle('第一章', 3, 'num')).toBe('第3章')
    expect(formatChapterTitle('第一章', 3, 'dot')).toBe('3.')
  })

  it('标题已带“第X章”时不重复添加', () => {
    expect(formatChapterTitle('第三章 雨夜', 3, 'cn')).toBe('第三章 雨夜')
    expect(formatChapterTitle('第 5 章 酒馆', 5, 'num')).toBe('第5章 酒馆')
  })
})

describe('长段落拆分', () => {
  it('短段落保持原样', () => {
    const t = '短句。另一句。'
    expect(splitLongParagraphs(t, 200)).toBe(t)
  })

  it('超长段落按标点拆开', () => {
    const long = '第一句。'.repeat(40)
    const out = splitLongParagraphs(long, 100)
    expect(out.split('\n').length).toBeGreaterThan(1)
    expect(out.replace(/\n/g, '')).toBe(long)
  })

  it('保留原有换行', () => {
    const t = '第一段。\n第二段。'
    expect(splitLongParagraphs(t, 200)).toBe(t)
  })
})
