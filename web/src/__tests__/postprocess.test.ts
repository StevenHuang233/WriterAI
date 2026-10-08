import { describe, expect, it } from 'vitest'
import { cleanSuggestion, finalizeSuggestion, splitAtPunctuation } from '../editor/postprocess'

describe('cleanSuggestion', () => {
  it('去掉整段包裹的引号与空白', () => {
    expect(cleanSuggestion('  “他抬起头。”  ', '他沉默片刻。', '')).toBe('他抬起头。')
  })

  it('对白引导（冒号后）保留引号', () => {
    expect(cleanSuggestion('“有人吗？”', '他低声道：', '')).toBe('“有人吗？”')
  })

  it('前文已打开引号时去掉重复的开引号', () => {
    expect(cleanSuggestion('“有人吗？”', '他低声道：“', '')).toBe('有人吗？”')
  })

  it('去掉与 prefix 末尾重叠的部分', () => {
    // 重叠检测含标点：前缀以“推开门，”结尾，提示开头与之重复
    expect(cleanSuggestion('推开门，屋里一片漆黑', '……林墨推开门，', '')).toBe('屋里一片漆黑')
    expect(cleanSuggestion('屋里一片漆黑', '……林墨推开门，', '')).toBe('屋里一片漆黑')
  })

  it('去掉与 suffix 开头重复的部分', () => {
    expect(cleanSuggestion('他点亮了油灯，他环顾四周', '', '他环顾四周。')).toBe('他点亮了油灯，')
  })
})

describe('finalizeSuggestion', () => {
  it('截断到最后一个完整标点', () => {
    expect(finalizeSuggestion('他抬起头。望向远', '', '')).toBe('他抬起头。')
  })

  it('无标点时原样返回', () => {
    expect(finalizeSuggestion('他抬起头望向远', '', '')).toBe('他抬起头望向远')
  })

  it('只有一个标点在末尾时不截断', () => {
    expect(finalizeSuggestion('他抬起头。', '', '')).toBe('他抬起头。')
  })

  it('完整的多分句保留，不在第一个逗号处截断', () => {
    expect(finalizeSuggestion('他点亮油灯，火光摇曳。', '', '')).toBe('他点亮油灯，火光摇曳。')
  })

  it('闭合引号随标点保留', () => {
    expect(finalizeSuggestion('“有人吗？”他又问了一', '他低声道：', '')).toBe('“有人吗？”')
  })
})

describe('splitAtPunctuation', () => {
  it('在第一个标点处分割（含标点）', () => {
    expect(splitAtPunctuation('他抬起头。望向远方，沉默')).toEqual({
      accepted: '他抬起头。',
      rest: '望向远方，沉默',
    })
  })

  it('标点后的闭合引号一起接受', () => {
    expect(splitAtPunctuation('有人吗？”他问')).toEqual({ accepted: '有人吗？”', rest: '他问' })
  })

  it('无标点时全部接受', () => {
    expect(splitAtPunctuation('他抬起头望向远方')).toEqual({ accepted: '他抬起头望向远方', rest: '' })
  })
})
