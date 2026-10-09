import JSZip from 'jszip'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import type { ChapterRow, ProjectRow } from '../db/repo.js'

export type ExportFormat = 'txt' | 'md' | 'html' | 'docx' | 'zip'
export type TitleTemplate = 'cn' | 'num' | 'dot' | 'plain'
export type ExportScope = 'all' | 'chapter'

export interface ExportOptions {
  format: ExportFormat
  scope: ExportScope
  chapterIds?: string[]
  titleTemplate: TitleTemplate
  /** Markdown 是否加 YAML front matter */
  frontMatter?: boolean
  /** 过长段落自动按标点拆分（便于手机阅读） */
  splitLong?: boolean
}

export interface ExportResult {
  filename: string
  mime: string
  body: string | Uint8Array
}

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 章节序号转中文数字（支持到 9999） */
export function cnNumeral(n: number): string {
  if (n < 10) return DIGITS[n] ?? String(n)
  if (n < 20) return '十' + (n % 10 ? DIGITS[n % 10]! : '')
  if (n < 100) return DIGITS[Math.floor(n / 10)]! + '十' + (n % 10 ? DIGITS[n % 10]! : '')
  if (n < 1000) {
    const h = Math.floor(n / 100)
    const r = n % 100
    const head = DIGITS[h]! + '百'
    if (r === 0) return head
    if (r < 10) return head + '零' + DIGITS[r]!
    // 110 读作“一百一十”而非“一百十”
    if (r < 20) return head + '一' + cnNumeral(r)
    return head + cnNumeral(r)
  }
  const t = Math.floor(n / 1000)
  const r = n % 1000
  const head = DIGITS[t]! + '千'
  if (r === 0) return head
  if (r < 100) return head + '零' + (r < 10 ? DIGITS[r]! : cnNumeral(r))
  return head + cnNumeral(r)
}

const CHAPTER_PREFIX = /^\s*第\s*[0-9一二三四五六七八九十百千零〇]+\s*[章节回篇]\s*/

/** 按模板生成用于导出的章节标题（已有“第X章”前缀则不再重复添加） */
export function formatChapterTitle(title: string, order: number, template: TitleTemplate): string {
  const stripped = title.replace(CHAPTER_PREFIX, '').trim()
  // 标题本身就是“第一章”这类没有名字的情况，不要再接一个空名字
  if (!stripped) {
    switch (template) {
      case 'cn':
        return `第${cnNumeral(order)}章`
      case 'num':
        return `第${order}章`
      case 'dot':
        return `${order}.`
      default:
        return title.trim()
    }
  }
  const name = stripped
  switch (template) {
    case 'cn':
      return `第${cnNumeral(order)}章 ${name}`
    case 'num':
      return `第${order}章 ${name}`
    case 'dot':
      return `${order}. ${name}`
    case 'plain':
    default:
      return name
  }
}

const SPLIT_CHARS = /[。！？；…!?;]/

/** 过长段落按标点拆成多段，便于手机阅读 */
export function splitLongParagraphs(content: string, maxLen = 200): string {
  return content
    .split('\n')
    .flatMap((para) => {
      if (para.trim().length <= maxLen) return [para]
      const out: string[] = []
      let buf = ''
      for (const ch of para) {
        buf += ch
        if (SPLIT_CHARS.test(ch) && buf.length >= maxLen / 2) {
          out.push(buf)
          buf = ''
        }
      }
      if (buf.trim()) out.push(buf)
      return out
    })
    .join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function pickChapters(chapters: ChapterRow[], opts: ExportOptions): ChapterRow[] {
  const sorted = [...chapters].sort((a, b) => a.sort_order - b.sort_order)
  if (opts.scope === 'chapter' && opts.chapterIds?.length) {
    const set = new Set(opts.chapterIds)
    return sorted.filter((c) => set.has(c.id))
  }
  return sorted
}

function toTxt(project: ProjectRow, chapters: ChapterRow[], opts: ExportOptions): string {
  const parts = chapters.map(
    (ch) =>
      `${formatChapterTitle(ch.title, ch.sort_order, opts.titleTemplate)}\n\n${
        opts.splitLong ? splitLongParagraphs(ch.content) : ch.content
      }`,
  )
  return `${project.title}\n\n${parts.join('\n\n')}\n`
}

function toMarkdown(project: ProjectRow, chapters: ChapterRow[], opts: ExportOptions): string {
  const head = opts.frontMatter
    ? `---\ntitle: ${project.title}\ndate: ${new Date().toISOString().slice(0, 10)}\ntags: [小说]\n---\n\n`
    : ''
  const body = chapters
    .map(
      (ch) =>
        `## ${formatChapterTitle(ch.title, ch.sort_order, opts.titleTemplate)}\n\n${
          opts.splitLong ? splitLongParagraphs(ch.content) : ch.content
        }`,
    )
    .join('\n\n')
  return `${head}# ${project.title}\n\n${body}\n`
}

function toHtml(project: ProjectRow, chapters: ChapterRow[], opts: ExportOptions): string {
  const body = chapters
    .map(
      (ch) =>
        `<h2>${escapeHtml(formatChapterTitle(ch.title, ch.sort_order, opts.titleTemplate))}</h2>\n` +
        (opts.splitLong ? splitLongParagraphs(ch.content) : ch.content)
          .split('\n')
          .filter((p) => p.trim())
          .map((p) => `<p>${escapeHtml(p)}</p>`)
          .join('\n'),
    )
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.title)}</title>
<style>
body{max-width:42rem;margin:2rem auto;padding:0 1rem;font-family:"Noto Serif SC",Georgia,serif;font-size:18px;line-height:1.9;color:#222}
h1{font-size:28px;margin-bottom:2rem}
h2{font-size:22px;margin:2.5rem 0 1rem}
p{margin:0 0 1em;text-indent:0}
</style>
</head>
<body>
<h1>${escapeHtml(project.title)}</h1>
${body}
</body>
</html>
`
}

async function toDocx(project: ProjectRow, chapters: ChapterRow[], opts: ExportOptions): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ text: project.title, heading: HeadingLevel.TITLE }),
  ]
  for (const ch of chapters) {
    children.push(
      new Paragraph({
        text: formatChapterTitle(ch.title, ch.sort_order, opts.titleTemplate),
        heading: HeadingLevel.HEADING_1,
      }),
    )
    const text = opts.splitLong ? splitLongParagraphs(ch.content) : ch.content
    for (const para of text.split('\n')) {
      children.push(new Paragraph({ children: [new TextRun(para)] }))
    }
  }
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}

async function toZip(project: ProjectRow, chapters: ChapterRow[], opts: ExportOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  const folder = zip.folder(project.title.replace(/[/\\?%*:|"<>]/g, '_')) ?? zip
  for (const ch of chapters) {
    const name = formatChapterTitle(ch.title, ch.sort_order, opts.titleTemplate)
    const safe = name.replace(/[/\\?%*:|"<>]/g, '_')
    const text = opts.splitLong ? splitLongParagraphs(ch.content) : ch.content
    folder.file(`${String(ch.sort_order).padStart(3, '0')} ${safe}.txt`, text)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

export async function buildExport(
  project: ProjectRow,
  chapters: ChapterRow[],
  opts: ExportOptions,
): Promise<ExportResult> {
  const picked = pickChapters(chapters, opts)
  if (picked.length === 0) throw new Error('没有可导出的章节')

  const base = project.title.replace(/[/\\?%*:|"<>]/g, '_')
  const suffix = picked.length === 1 ? `-${picked[0]!.title.replace(/[/\\?%*:|"<>]/g, '_')}` : ''

  switch (opts.format) {
    case 'md':
      return { filename: `${base}${suffix}.md`, mime: 'text/markdown; charset=utf-8', body: toMarkdown(project, picked, opts) }
    case 'html':
      return { filename: `${base}${suffix}.html`, mime: 'text/html; charset=utf-8', body: toHtml(project, picked, opts) }
    case 'docx':
      return {
        filename: `${base}${suffix}.docx`,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: await toDocx(project, picked, opts),
      }
    case 'zip':
      return { filename: `${base}-分章.zip`, mime: 'application/zip', body: await toZip(project, picked, opts) }
    case 'txt':
    default:
      return { filename: `${base}${suffix}.txt`, mime: 'text/plain; charset=utf-8', body: toTxt(project, picked, opts) }
  }
}
