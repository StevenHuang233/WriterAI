const PUNCTUATION = /[，。！？；：、…—”』」）,.!?;:)\]】]/

/**
 * 流式期间的基础清洗：去首尾引号与空白。
 * 不做完整标点截断，避免流式中间过程显示不完整。
 */
export function cleanSuggestion(raw: string, prefix: string, suffix: string): string {
  let t = raw.trim()
  const prevChar = prefix.trimEnd().slice(-1)
  if (/[“「『"]/.test(prevChar)) {
    // 前文已打开引号：去掉模型重复的开引号
    while (t.length > 0 && /[“「『"]/.test(t[0]!)) t = t.slice(1)
  } else if (!/[：:，,]/.test(prevChar)) {
    // 前文不是对白引导：整段被引号包裹时视为模型多加的包装，去掉
    const m = t.match(/^[“"「『]([^“”"「」『』]*)[”"」』]$/)
    if (m) t = m[1]!
  }
  // 去掉与光标前文本末尾重叠的部分
  if (prefix.length > 0 && t.length > 0) {
    const max = Math.min(t.length, 30, prefix.length)
    for (let len = max; len > 0; len--) {
      if (prefix.endsWith(t.slice(0, len))) {
        t = t.slice(len)
        break
      }
    }
  }
  // 去掉与光标后文本开头重复的部分
  if (suffix.length > 0 && t.length > 0) {
    const max = Math.min(t.length, 30, suffix.length)
    for (let len = max; len > 0; len--) {
      if (suffix.startsWith(t.slice(t.length - len))) {
        t = t.slice(0, t.length - len)
        break
      }
    }
  }
  return t
}

/**
 * 完成后处理：在 cleanSuggestion 基础上截断到最后一个完整标点。
 * 无标点时原样返回（短提示可能就是几个字）。
 */
export function finalizeSuggestion(raw: string, prefix: string, suffix: string): string {
  const t = cleanSuggestion(raw, prefix, suffix)
  if (!t) return ''
  let last = -1
  for (let i = t.length - 1; i >= 0; i--) {
    if (PUNCTUATION.test(t[i]!)) {
      last = i
      break
    }
  }
  if (last < 0) return t
  return t.slice(0, extendClosers(t, last + 1))
}

const CLOSERS = /[”’」』）)\]】"]/

/** 标点后紧跟的闭合引号/括号一起算进来 */
function extendClosers(text: string, i: number): number {
  while (i < text.length && CLOSERS.test(text[i]!)) i++
  return i
}

/** 部分接受：返回到下一个标点为止（含标点及其后的闭合引号）的内容 */
export function splitAtPunctuation(text: string): { accepted: string; rest: string } {
  const m = text.match(PUNCTUATION)
  if (!m || m.index === undefined) return { accepted: text, rest: '' }
  const i = extendClosers(text, m.index + 1)
  return { accepted: text.slice(0, i), rest: text.slice(i) }
}
