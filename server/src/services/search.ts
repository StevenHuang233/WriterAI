/** 全文搜索与批量替换（纯 indexOf，不使用正则，避免 ReDoS） */

export interface SearchMatch {
  chapterId: string
  title: string
  index: number
  preview: string
}

const MAX_MATCHES_PER_CHAPTER = 200

export interface ChapterLike {
  id: string
  title: string
  content: string
}

export function searchChapters(chapters: ChapterLike[], query: string): { matches: SearchMatch[]; total: number } {
  const matches: SearchMatch[] = []
  if (!query) return { matches, total: 0 }
  let total = 0
  for (const ch of chapters) {
    let from = 0
    let count = 0
    for (;;) {
      const idx = ch.content.indexOf(query, from)
      if (idx < 0) break
      total++
      if (count < MAX_MATCHES_PER_CHAPTER) {
        const start = Math.max(0, idx - 20)
        const end = Math.min(ch.content.length, idx + query.length + 30)
        matches.push({
          chapterId: ch.id,
          title: ch.title,
          index: idx,
          preview: ch.content.slice(start, end).replace(/\n/g, '⏎'),
        })
      }
      count++
      from = idx + query.length
    }
  }
  return { matches, total }
}

export function countInText(text: string, query: string): number {
  if (!query) return 0
  let count = 0
  let from = 0
  for (;;) {
    const idx = text.indexOf(query, from)
    if (idx < 0) break
    count++
    from = idx + query.length
  }
  return count
}

export function replaceInText(text: string, query: string, replacement: string): { text: string; count: number } {
  if (!query) return { text, count: 0 }
  const count = countInText(text, query)
  if (count === 0) return { text, count: 0 }
  return { text: text.split(query).join(replacement), count }
}
