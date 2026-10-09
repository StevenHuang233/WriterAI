import { createHash } from 'node:crypto'
import { env } from '../env.js'
import { chatOnceRobust } from '../llm/client.js'
import { segmentCompressPrompt } from '../llm/prompts.js'
import {
  clearSegments, getContextSettings, listChaptersFull, listSegments, upsertSegment,
} from '../db/repo.js'

export interface SegmentRefreshResult {
  size: number
  total: number
  generated: number
  skipped: number
  failed: number
}

/** 合段摘要的目标字数（远段各档位的上限是 60～130，生成时留一点余量） */
const SEGMENT_TARGET_CHARS = 110
const MAX_STORED_CHARS = 400

const inflight = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function hashInputs(inputs: { order: number; title: string; summary: string }[]): string {
  return createHash('sha1').update(JSON.stringify(inputs)).digest('hex').slice(0, 16)
}

/**
 * 生成/更新远段合段摘要：把连续的 groupSize 章压缩成一段话。
 * 已有且源摘要未变化的段会跳过，因此重复调用不会重复消耗模型。
 */
export async function refreshSegments(
  projectId: string,
  opts: { force?: boolean } = {},
): Promise<SegmentRefreshResult> {
  if (inflight.has(projectId)) {
    return { size: 0, total: 0, generated: 0, skipped: 0, failed: 0 }
  }
  inflight.add(projectId)
  try {
    const settings = getContextSettings(projectId)
    const size = settings.groupSize
    const chapters = listChaptersFull(projectId)
    const result: SegmentRefreshResult = { size, total: 0, generated: 0, skipped: 0, failed: 0 }
    if (chapters.length === 0) return result

    const existing = new Map(listSegments(projectId, size).map((r) => [r.start_order, r]))

    for (let i = 0; i < chapters.length; i += size) {
      const members = chapters.slice(i, i + size)
      if (members.length === 0) continue
      result.total++
      const inputs = members.map((c) => ({
        order: c.sort_order,
        title: c.title,
        summary: c.summary_brief.trim() || c.summary_micro.trim() || c.summary.trim(),
      }))
      // 段内还有章节没生成摘要时不压缩，等摘要补齐后再来
      if (inputs.some((x) => !x.summary)) {
        result.skipped++
        continue
      }
      const startOrder = members[0]!.sort_order
      const hash = hashInputs(inputs)
      const row = existing.get(startOrder)
      if (row && row.source_hash === hash && !opts.force) {
        result.skipped++
        continue
      }
      try {
        const text = await chatOnceRobust('strong', segmentCompressPrompt(inputs, SEGMENT_TARGET_CHARS), {
          // 推理模型的思考 token 会占用输出预算，留足余量
          maxTokens: 2000,
          temperature: 0.3,
          effort: env.strong.effort || undefined,
        })
        if (!text.trim()) {
          result.failed++
          console.error(`[segmenter] 第${startOrder}–${members[members.length - 1]!.sort_order}章压缩结果为空`)
          continue
        }
        upsertSegment({
          project_id: projectId,
          size,
          start_order: startOrder,
          end_order: members[members.length - 1]!.sort_order,
          chapter_ids: JSON.stringify(members.map((m) => m.id)),
          text: text.trim().slice(0, MAX_STORED_CHARS),
          source_hash: hash,
          updated_at: Date.now(),
        })
        result.generated++
      } catch (e) {
        result.failed++
        console.error(
          `[segmenter] 第${startOrder}–${members[members.length - 1]!.sort_order}章压缩失败:`,
          e instanceof Error ? e.message : String(e),
        )
      }
    }
    return result
  } finally {
    inflight.delete(projectId)
  }
}

/** 章节摘要生成后，延迟一会儿再压缩受影响的段（合并多次连续保存） */
export function scheduleSegmentRefresh(projectId: string, delayMs = 4000): void {
  const prev = timers.get(projectId)
  if (prev) clearTimeout(prev)
  const t = setTimeout(() => {
    timers.delete(projectId)
    void refreshSegments(projectId).catch(() => undefined)
  }, delayMs)
  timers.set(projectId, t)
}

/** 合段粒度变化时清掉旧粒度的段，避免堆积无用数据 */
export function resetSegments(projectId: string, size: number): void {
  clearSegments(projectId, size)
}
