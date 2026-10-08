export interface ProjectMeta {
  id: string
  title: string
  created_at: number
  updated_at: number
}

export interface Project {
  id: string
  title: string
  synopsis: string
  global_summary: string
  style_note: string
  created_at: number
  updated_at: number
}

export type ImportMode = 'md-heading' | 'chapter-regex' | 'single'

export interface ChapterMeta {
  id: string
  project_id: string
  sort_order: number
  title: string
  /** 章节细纲 */
  outline: string
  summary: string
  summary_locked: 0 | 1
  summarized_len: number
  content_length: number
  created_at: number
  updated_at: number
}

export interface Chapter extends ChapterMeta {
  content: string
}

export type LoreType = 'character' | 'location' | 'item' | 'faction' | 'world' | 'other'

export const LORE_TYPE_LABELS: Record<LoreType, string> = {
  character: '人物',
  location: '地点',
  item: '物品',
  faction: '势力',
  world: '世界观',
  other: '其他',
}

export interface LoreEntry {
  id: string
  project_id: string
  type: LoreType
  name: string
  aliases: string[]
  content: string
  current_state: string
  always_on: boolean
  priority: number
  enabled: boolean
  updated_at: number
}

export interface ProjectDetail {
  project: Project
  chapters: ChapterMeta[]
  lore: LoreEntry[]
}

export interface SettingsInfo {
  fast: { model: string; configured: boolean }
  strong: { model: string; configured: boolean }
}

export interface JobInfo {
  chapterId: string
  chapterTitle: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
  updates?: { name: string; current_state: string }[]
  updatedAt: number
}

export interface SuggestMeta {
  usedLoreNames: string[]
  contextChars: number
  model: string
}

export type SuggestMode = 'inline' | 'continue'

export type SuggestLength = 'short' | 'medium' | 'long'

export const SUGGEST_LENGTH_LABELS: Record<SuggestLength, string> = {
  short: '短（1 句）',
  medium: '中（默认）',
  long: '长（几句）',
}
