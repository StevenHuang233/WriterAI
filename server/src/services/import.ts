/** 从 Markdown / 纯文本导入章节 */

export type ImportMode = 'md-heading' | 'chapter-regex' | 'single'

export interface ImportedChapter {
  title: string
  content: string
}

const MD_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*$/
const CN_CHAPTER = /^\s*(第[0-9一二三四五六七八九十百千零〇]+[章节回篇][^\n]{0,60})\s*$/

export function parseImport(text: string, mode: ImportMode, defaultTitle = '导入章节'): ImportedChapter[] {
  const src = text.replace(/\r\n?/g, '\n')
  if (mode === 'single') {
    return [{ title: defaultTitle, content: src.trim() }]
  }
  if (mode === 'md-heading') {
    return splitByPattern(src, (line) => {
      const m = line.match(MD_HEADING)
      return m && m[1] ? m[1].replace(/[#*`_]/g, '').trim() : null
    }, defaultTitle)
  }
  return splitByPattern(src, (line) => {
    const m = line.match(CN_CHAPTER)
    return m && m[1] ? m[1].trim() : null
  }, defaultTitle)
}

function splitByPattern(
  src: string,
  titleOf: (line: string) => string | null,
  defaultTitle: string,
): ImportedChapter[] {
  const lines = src.split('\n')
  const out: ImportedChapter[] = []
  let title: string | null = null
  let buf: string[] = []

  const flush = () => {
    const content = buf.join('\n').trim()
    if (content) out.push({ title: title ?? defaultTitle, content })
    else if (title) out.push({ title, content: '' })
    buf = []
  }

  for (const line of lines) {
    const heading = titleOf(line)
    if (heading) {
      flush()
      title = heading
    } else {
      buf.push(line)
    }
  }
  flush()

  if (out.length === 0) return [{ title: defaultTitle, content: src.trim() }]
  // 无标题时给默认名
  return out.map((c, i) => ({ title: c.title || `${defaultTitle} ${i + 1}`, content: c.content }))
}
