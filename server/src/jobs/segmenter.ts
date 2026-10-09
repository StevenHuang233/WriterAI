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

export interface SegmentProgress {
  running: boolean
  total: number
  done: number
  generated: number
  failed: number
}

const inflight = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** 上一次的结果：并发调用时至少有东西可返回 */
const lastResult = new Map<string, SegmentRefreshResult>()
const progress = new Map<string, SegmentProgress>()

export function getSegmentProgress(projectId: string): SegmentProgress {
  return progress.get(projectId) ?? { running: false, total: 0, done: 0, generated: 0, failed: 0 }
}

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
    return lastResult.get(projectId) ?? { size: 0, total: 0, generated: 0, skipped: 0, failed: 0 }
  }
  inflight.add(projectId)
  try {
    const settings = getContextSettings(projectId)
    const size = settings.groupSize
    const chapters = listChaptersFull(projectId)
    const total = Math.ceil(chapters.length / size)
    const result: SegmentRefreshResult = { size, total, generated: 0, skipped: 0, failed: 0 }
    lastResult.set(projectId, result)
    const prog: SegmentProgress = { running: true, total, done: 0, generated: 0, failed: 0 }
    progress.set(projectId, prog)
    if (chapters.length === 0) {
      prog.running = false
      return result
    }

    const existing = new Map(listSegments(projectId, size).map((r) => [r.start_order, r]))

    for (let i = 0; i < chapters.length; i += size) {
      const members = chapters.slice(i, i + size)
      if (members.length === 0) continue
      prog.done++
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
      const range = `第${startOrder}–${members[members.length - 1]!.sort_order}章`
      try {
        let text = await chatOnceRobust('strong', segmentCompressPrompt(inputs, SEGMENT_TARGET_CHARS), {
          // 推理模型的思考 token 会占用输出预算，留足余量
          maxTokens: 2500,
          temperature: 0.3,
          effort: env.strong.effort || undefined,
        })
        if (!text.trim()) {
          // 输入越长，思考占得越多：退化成更短的素材再压一次
          const short = inputs.map((i) => ({ ...i, summary: i.summary.slice(0, 120) }))
          text = await chatOnceRobust('strong', segmentCompressPrompt(short, SEGMENT_TARGET_CHARS), {
            maxTokens: 3000,
            temperature: 0.3,
            effort: 'low',
          })
        }
        if (!text.trim()) {
          result.failed++
          console.error(`[segmenter] ${range} 压缩结果为空`)
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
        prog.generated = result.generated
      } catch (e) {
        result.failed++
        prog.failed = result.failed
        console.error(`[segmenter] ${range} 压缩失败:`, e instanceof Error ? e.message : String(e))
      }
    }
    prog.running = false
    return result
  } finally {
    inflight.delete(projectId)
    const p = progress.get(projectId)
    if (p) p.running = false
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
