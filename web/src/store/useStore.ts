import { create } from 'zustand'
import {
  apiCreateChapter, apiCreateLore, apiCreateProject, apiDeleteChapter, apiDeleteLore,
  apiDeleteProject, apiGetProject, apiJobs, apiListProjects, apiPatchChapter, apiPatchLore,
  apiPatchProject, apiSettings,
} from '../api/client'
import { apiGetChapter } from '../api/chapter'
import type {
  Chapter, ChapterMeta, JobInfo, LoreEntry, LoreType, ProjectDetail, ProjectMeta,
  SettingsInfo, SuggestLength,
} from '../types'

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error'
export type TriggerStateUi = 'idle' | 'waiting' | 'requesting' | 'showing' | 'paused'

export interface Prefs {
  idleMs: number
  paused: boolean
  theme: 'light' | 'dark'
  suggestLength: SuggestLength
}

const PREFS_KEY = 'writerai-prefs'
const LAST_PROJECT_KEY = 'writerai-last-project'

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '') as Partial<Prefs>
    return {
      idleMs: typeof v.idleMs === 'number' && v.idleMs >= 2000 && v.idleMs <= 10000 ? v.idleMs : 4000,
      paused: v.paused === true,
      theme: v.theme === 'dark' ? 'dark' : 'light',
      suggestLength: v.suggestLength === 'short' || v.suggestLength === 'long' ? v.suggestLength : 'medium',
    }
  } catch {
    return { idleMs: 4000, paused: false, theme: 'light', suggestLength: 'medium' }
  }
}

function savePrefs(p: Prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p))
}

interface Store {
  projects: ProjectMeta[]
  detail: ProjectDetail | null
  activeChapter: Chapter | null
  settingsInfo: SettingsInfo | null
  jobs: JobInfo[]
  loadError: string | null

  prefs: Prefs
  saveState: SaveState
  triggerState: TriggerStateUi
  usedLoreNames: string[]
  lastLatencyMs: number | null
  lastSuggestError: string | null
  currentChapterChars: number
  jumpTarget: JumpTarget | null
  /** 递增以强制编辑器重新加载（外部改动正文后使用） */
  editorReloadToken: number

  init: () => Promise<void>
  setPrefs: (patch: Partial<Prefs>) => void

  openProject: (id: string) => Promise<void>
  createProject: (title: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  closeProject: () => void

  setActiveChapter: (id: string) => Promise<void>
  createChapter: (title: string) => Promise<void>
  deleteChapter: (id: string) => Promise<void>
  renameChapter: (id: string, title: string) => Promise<void>
  moveChapter: (id: string, dir: -1 | 1) => Promise<void>
  saveChapterContent: (id: string, content: string) => Promise<void>
  setChapterSummary: (id: string, summary: string, locked?: boolean) => Promise<void>
  updateChapterOutline: (id: string, outline: string) => Promise<void>
  setDraftChapterContent: (content: string) => void
  setJumpTarget: (t: JumpTarget | null) => void
  /** 从服务端重新拉取当前章节正文并强制编辑器刷新（替换、恢复版本等外部改动后调用） */
  reloadActiveChapter: () => Promise<void>

  updateProject: (patch: Partial<Pick<ProjectDetail['project'], 'title' | 'synopsis' | 'style_note' | 'global_summary'>>) => Promise<void>

  createLore: (payload: { type: LoreType; name: string }) => Promise<void>
  updateLore: (id: string, patch: Partial<Omit<LoreEntry, 'id' | 'project_id' | 'updated_at'>>) => Promise<void>
  deleteLore: (id: string) => Promise<void>

  refreshJobs: () => Promise<void>
  setUi: (patch: Partial<Pick<Store, 'saveState' | 'triggerState' | 'usedLoreNames' | 'lastLatencyMs' | 'lastSuggestError' | 'currentChapterChars' | 'loadError'>>) => void
}

export interface JumpTarget {
  chapterId: string
  query: string
  /** 第几个匹配（0 起） */
  occurrence: number
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const useStore = create<Store>((set, get) => ({
  projects: [],
  detail: null,
  activeChapter: null,
  settingsInfo: null,
  jobs: [],
  loadError: null,

  prefs: loadPrefs(),
  saveState: 'saved',
  triggerState: 'idle',
  usedLoreNames: [],
  lastLatencyMs: null,
  lastSuggestError: null,
  currentChapterChars: 0,
  jumpTarget: null,
  editorReloadToken: 0,

  init: async () => {
    applyTheme(get().prefs.theme)
    const [projects, settings] = await Promise.all([apiListProjects(), apiSettings()])
    set({ projects, settingsInfo: settings })
  },

  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch }
    savePrefs(prefs)
    applyTheme(prefs.theme)
    set({ prefs })
  },

  openProject: async (id) => {
    const detail = await apiGetProject(id)
    localStorage.setItem(LAST_PROJECT_KEY, id)
    set({ detail, loadError: null, currentChapterChars: 0 })
    const first = detail.chapters[0]
    if (first) {
      await get().setActiveChapter(first.id)
    } else {
      set({ activeChapter: null })
    }
  },

  createProject: async (title) => {
    const p = await apiCreateProject(title)
    await get().openProject(p.id)
    const projects = await apiListProjects()
    set({ projects })
  },

  deleteProject: async (id) => {
    await apiDeleteProject(id)
    if (get().detail?.project.id === id) {
      localStorage.removeItem(LAST_PROJECT_KEY)
      set({ detail: null, activeChapter: null })
    }
    set({ projects: await apiListProjects() })
  },

  closeProject: () => {
    localStorage.removeItem(LAST_PROJECT_KEY)
    set({ detail: null, activeChapter: null, triggerState: 'idle', usedLoreNames: [] })
  },

  setActiveChapter: async (id) => {
    // 延迟导入避免循环依赖（client 无循环，直接导入亦可，此处保持简单）
    const { apiGetChapter } = await import('../api/chapter')
    const ch = await apiGetChapter(id)
    set({ activeChapter: ch, currentChapterChars: ch.content.length, saveState: 'saved' })
  },

  createChapter: async (title) => {
    const detail = get().detail
    if (!detail) return
    const ch = await apiCreateChapter(detail.project.id, title)
    const fresh = await apiGetProject(detail.project.id)
    set({ detail: fresh })
    await get().setActiveChapter(ch.id)
  },

  deleteChapter: async (id) => {
    const detail = get().detail
    if (!detail) return
    await apiDeleteChapter(id)
    const fresh = await apiGetProject(detail.project.id)
    set({ detail: fresh })
    const active = get().activeChapter
    if (active?.id === id) {
      const first = fresh.chapters[0]
      if (first) await get().setActiveChapter(first.id)
      else set({ activeChapter: null })
    }
  },

  renameChapter: async (id, title) => {
    const detail = get().detail
    if (!detail) return
    await apiPatchChapter(id, { title })
    const fresh = await apiGetProject(detail.project.id)
    set({ detail: fresh })
  },

  moveChapter: async (id, dir) => {
    const detail = get().detail
    if (!detail) return
    const chapters = [...detail.chapters].sort((a, b) => a.sort_order - b.sort_order)
    const idx = chapters.findIndex((c) => c.id === id)
    const target = chapters[idx + dir]
    if (idx < 0 || !target) return
    await Promise.all([
      apiPatchChapter(id, { sort_order: target.sort_order }),
      apiPatchChapter(target.id, { sort_order: chapters[idx]!.sort_order }),
    ])
    const fresh = await apiGetProject(detail.project.id)
    set({ detail: fresh })
  },

  saveChapterContent: async (id, content) => {
    set({ saveState: 'saving' })
    try {
      await apiPatchChapter(id, { content })
      localStorage.removeItem(draftKey(id))
      const detail = get().detail
      if (detail) {
        const chapters = detail.chapters.map((c) => (c.id === id ? { ...c, content_length: content.length, updated_at: Date.now() } : c))
        set({ detail: { ...detail, chapters }, saveState: 'saved' })
      } else {
        set({ saveState: 'saved' })
      }
      const active = get().activeChapter
      if (active?.id === id) set({ activeChapter: { ...active, content, content_length: content.length } })
    } catch (e) {
      set({ saveState: 'error' })
      throw e
    }
  },

  setChapterSummary: async (id, summary, locked) => {
    const detail = get().detail
    if (!detail) return
    await apiPatchChapter(id, { summary, ...(locked !== undefined ? { summary_locked: locked } : {}) })
    const fresh = await apiGetProject(detail.project.id)
    set({ detail: fresh })
  },

  setDraftChapterContent: (content) => {
    set({ currentChapterChars: content.length })
  },

  setJumpTarget: (t) => set({ jumpTarget: t }),

  reloadActiveChapter: async () => {
    const active = get().activeChapter
    if (!active) return
    const ch = await apiGetChapter(active.id)
    set((s) => ({
      activeChapter: ch,
      currentChapterChars: ch.content.length,
      saveState: 'saved' as const,
      editorReloadToken: s.editorReloadToken + 1,
    }))
  },

  updateChapterOutline: async (id, outline) => {
    const detail = get().detail
    if (!detail) return
    await apiPatchChapter(id, { outline })
    const fresh = await apiGetProject(detail.project.id)
    set({ detail: fresh })
    const active = get().activeChapter
    if (active?.id === id) set({ activeChapter: { ...active, outline } })
  },

  updateProject: async (patch) => {
    const detail = get().detail
    if (!detail) return
    const project = await apiPatchProject(detail.project.id, patch)
    set({ detail: { ...detail, project } })
  },

  createLore: async (payload) => {
    const detail = get().detail
    if (!detail) return
    await apiCreateLore(detail.project.id, payload)
    const fresh = await apiGetProject(detail.project.id)
    set({ detail: fresh })
  },

  updateLore: async (id, patch) => {
    const detail = get().detail
    if (!detail) return
    const updated = await apiPatchLore(id, patch)
    set({
      detail: {
        ...detail,
        lore: detail.lore.map((l) => (l.id === id ? { ...updated, project_id: l.project_id } : l)),
      },
    })
  },

  deleteLore: async (id) => {
    const detail = get().detail
    if (!detail) return
    await apiDeleteLore(id)
    set({ detail: { ...detail, lore: detail.lore.filter((l) => l.id !== id) } })
  },

  refreshJobs: async () => {
    try {
      set({ jobs: await apiJobs() })
    } catch {
      // 静默失败
    }
  },

  setUi: (patch) => set(patch),
}))

export function draftKey(chapterId: string): string {
  return `writerai-draft-${chapterId}`
}

export function getLastProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY)
}

export type { ChapterMeta }
