import { z } from 'zod'
import {
  countAll, deleteAllProjects, getProject, listChaptersFull, listLore, listProjects,
  upsertChapterRow, upsertLoreRow, upsertProjectRow,
  type ChapterRow, type LoreRow, type ProjectRow,
} from '../db/repo.js'

export const SNAPSHOT_VERSION = 1

const ProjectSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(500),
  synopsis: z.string().max(50000),
  global_summary: z.string().max(50000),
  style_note: z.string().max(50000),
  created_at: z.number().int(),
  updated_at: z.number().int(),
})

const ChapterSchema = z.object({
  id: z.string().min(1).max(100),
  project_id: z.string().min(1).max(100),
  sort_order: z.number().int(),
  title: z.string().max(500),
  content: z.string().max(500_000),
  summary: z.string().max(20000),
  summary_locked: z.union([z.literal(0), z.literal(1), z.boolean()]),
  summarized_len: z.number().int(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
})

const LoreSchema = z.object({
  id: z.string().min(1).max(100),
  project_id: z.string().min(1).max(100),
  type: z.enum(['character', 'location', 'item', 'faction', 'world', 'other']),
  name: z.string().max(200),
  aliases: z.array(z.string().max(100)).max(50),
  content: z.string().max(50000),
  current_state: z.string().max(10000),
  always_on: z.union([z.literal(0), z.literal(1), z.boolean()]),
  priority: z.number().int(),
  enabled: z.union([z.literal(0), z.literal(1), z.boolean()]),
  updated_at: z.number().int(),
})

export const SnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  savedAt: z.number().int(),
  projects: z.array(
    z.object({
      project: ProjectSchema,
      chapters: z.array(ChapterSchema),
      lore: z.array(LoreSchema),
    }),
  ),
})

export type Snapshot = z.infer<typeof SnapshotSchema>

export interface SnapshotProject {
  project: ProjectRow
  chapters: ChapterRow[]
  lore: Array<Omit<LoreRow, 'aliases'> & { aliases: string[] }>
}

/** 把本地全部数据导出为快照 */
export function exportSnapshot(): Snapshot {
  const projects: Snapshot['projects'] = []
  for (const meta of listProjects()) {
    const project = getProject(meta.id)
    if (!project) continue
    projects.push({
      project,
      chapters: listChaptersFull(meta.id),
      lore: listLore(meta.id).map((l) => ({
        ...l,
        aliases: JSON.parse(l.aliases) as string[],
      })),
    })
  }
  return { version: SNAPSHOT_VERSION, savedAt: Date.now(), projects }
}

/** 校验来自云端的（不可信）数据 */
export function parseSnapshot(raw: unknown): Snapshot {
  return SnapshotSchema.parse(raw)
}

function to01(v: boolean | 0 | 1): 0 | 1 {
  return typeof v === 'boolean' ? (v ? 1 : 0) : v
}

/**
 * 从快照导入。
 * - replace：先清空本地再导入（以云端为准）
 * - merge：  按 id 覆盖，本地独有的保留
 */
export function importSnapshot(
  snap: Snapshot,
  mode: 'replace' | 'merge',
): { projects: number; chapters: number; lore: number } {
  if (mode === 'replace') deleteAllProjects()
  let chapters = 0
  let lore = 0
  for (const item of snap.projects) {
    upsertProjectRow(item.project as ProjectRow)
    for (const ch of item.chapters) {
      upsertChapterRow({ ...ch, summary_locked: to01(ch.summary_locked) } as ChapterRow)
      chapters++
    }
    for (const l of item.lore) {
      upsertLoreRow({
        ...l,
        aliases: JSON.stringify(l.aliases),
        always_on: to01(l.always_on),
        enabled: to01(l.enabled),
      } as LoreRow)
      lore++
    }
  }
  return { projects: snap.projects.length, chapters, lore }
}

export function localCounts(): { projects: number; chapters: number; lore: number } {
  return countAll()
}
