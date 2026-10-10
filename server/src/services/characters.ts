/**
 * 解析人物相关模型的输出。
 * 这些提示词都用「标记行」而不是 JSON——实测推理模型被要求输出 JSON 时会把
 * token 消耗在思考上导致返回空（与 services/summary.ts 同样的处理）。
 */

export interface DetectedCharacter {
  name: string
  aliases: string[]
  role: string
  appearance: string
  personality: string
  motivation: string
  catchphrase: string
  note: string
}

export interface FilledCharacter {
  gender: string
  age: string
  role: string
  appearance: string
  personality: string
  motivation: string
  catchphrase: string
  content: string
}

export interface ParsedRelation {
  name: string
  label: string
}

/** 取某个标记后的内容，直到下一个标记或文本结束 */
function pickTag(text: string, tag: string, allTags: readonly string[]): string {
  const start = text.indexOf(`【${tag}】`)
  if (start < 0) return ''
  let end = text.length
  for (const t of allTags) {
    const i = text.indexOf(`【${t}】`, start + tag.length + 2)
    if (i >= 0) end = Math.min(end, i)
  }
  return text.slice(start + tag.length + 2, end).trim()
}

const DETECT_TAGS = ['人物', '别名', '身份', '外貌', '性格', '动机', '口头禅', '备注'] as const

export function parseDetectedCharacters(raw: string): DetectedCharacter[] {
  const text = (raw ?? '').trim()
  if (!text) return []
  // 没有标记块时按「姓名｜身份」逐行解析（当前提示词用的就是这种简单格式）
  const hasBlock =
    text.includes('【人物】') ||
    /^【?人物】?[:：]/m.test(text) ||
    /【(身份|外貌|性格|动机|口头禅|备注)】/.test(text)
  if (!hasBlock) {
    return parseRelations(text).map((r) => ({
      name: r.name,
      aliases: [],
      role: r.label,
      appearance: '',
      personality: '',
      motivation: '',
      catchphrase: '',
      note: '',
    }))
  }
  // 以【人物】为界切块；兼容模型可能写成「人物：」的形式
  const normalized = text.replace(/^【?人物】?[:：]/gm, '【人物】')
  const blocks: string[] = []
  const marks = [...normalized.matchAll(/【人物】/g)].map((m) => m.index ?? 0)
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i]! + 4
    const end = i + 1 < marks.length ? marks[i + 1]! : normalized.length
    blocks.push(normalized.slice(start, end))
  }
  if (blocks.length === 0) return []

  const out: DetectedCharacter[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const name = (lines[0] ?? '').trim()
    if (!name || name.length > 50) continue
    const rest = lines.slice(1).join('\n')
    const aliases = pickTag(rest, '别名', DETECT_TAGS)
    out.push({
      name,
      aliases: aliases
        .split(/[、,，\/|｜]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 50)
        .slice(0, 10),
      role: pickTag(rest, '身份', DETECT_TAGS),
      appearance: pickTag(rest, '外貌', DETECT_TAGS),
      personality: pickTag(rest, '性格', DETECT_TAGS),
      motivation: pickTag(rest, '动机', DETECT_TAGS),
      catchphrase: pickTag(rest, '口头禅', DETECT_TAGS),
      note: pickTag(rest, '备注', DETECT_TAGS),
    })
  }
  return out
}

const FILL_TAGS = ['性别', '年龄', '身份', '外貌', '性格', '动机', '口头禅', '设定'] as const

export function parseFilledCharacter(raw: string): FilledCharacter {
  const text = (raw ?? '').trim()
  return {
    gender: pickTag(text, '性别', FILL_TAGS),
    age: pickTag(text, '年龄', FILL_TAGS),
    role: pickTag(text, '身份', FILL_TAGS),
    appearance: pickTag(text, '外貌', FILL_TAGS),
    personality: pickTag(text, '性格', FILL_TAGS),
    motivation: pickTag(text, '动机', FILL_TAGS),
    catchphrase: pickTag(text, '口头禅', FILL_TAGS),
    content: pickTag(text, '设定', FILL_TAGS),
  }
}

/** 每行「姓名｜关系」 */
export function parseRelations(raw: string): ParsedRelation[] {
  const out: ParsedRelation[] = []
  for (const line of (raw ?? '').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('【')) continue
    const m = t.split(/[｜|]/)
    if (m.length < 2) continue
    const name = m[0]!.trim()
    const label = m.slice(1).join('｜').trim()
    if (!name || !label || name.length > 50) continue
    out.push({ name, label: label.slice(0, 200) })
  }
  return out
}
