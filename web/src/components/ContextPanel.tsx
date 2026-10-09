import { useEffect, useState } from 'react'
import {
  apiContextPreview, apiSaveContextSettings, apiRefreshSegments, apiSegmentProgress, apiContextTree,
  type ContextBlock, type ContextChainEntry, type ContextSettings, type ContextTree,
} from '../api/client'
import { useStore } from '../store/useStore'
import ContextTreeGraph from './ContextTreeGraph'

const TIER_LABELS: Record<string, string> = {
  full: '完整摘要',
  brief: '一句话',
  micro: '极简',
}

const GROUP_OPTIONS = [2, 3, 4, 5, 8]

export default function ContextPanel() {
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)
  const [settings, setSettings] = useState<ContextSettings | null>(null)
  const [blocks, setBlocks] = useState<ContextBlock[]>([])
  const [chain, setChain] = useState<ContextChainEntry[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [segBusy, setSegBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'tree'>('tree')
  const [tree, setTree] = useState<ContextTree | null>(null)

  async function load() {
    if (!projectId) return
    const r = await apiContextPreview(projectId, activeChapterId ?? undefined)
    setSettings(r.settings)
    setBlocks(r.blocks)
    setChain(r.chain)
    setTotal(r.totalChars)
    if (view === 'tree') {
      const t = await apiContextTree(projectId, activeChapterId ?? undefined)
      setTree(t.tree)
      setSettings(t.settings)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeChapterId, view])

  async function apply(patch: Partial<ContextSettings>) {
    if (!projectId || !settings) return
    setBusy(true)
    try {
      const next = { ...settings, ...patch }
      setSettings(next)
      await apiSaveContextSettings(projectId, patch)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const toggleBlock = (key: string) => {
    if (!settings) return
    const has = settings.disabledBlocks.includes(key)
    void apply({
      disabledBlocks: has
        ? settings.disabledBlocks.filter((k) => k !== key)
        : [...settings.disabledBlocks, key],
    })
  }

  /** 合段条目一次切换它覆盖的所有章节 */
  const idsOf = (c: ContextChainEntry) => c.segment?.chapterIds ?? [c.chapterId]

  const toggleExclude = (ids: string[]) => {
    if (!settings) return
    const cur = new Set(settings.excludedChapters)
    const allExcluded = ids.every((i) => cur.has(i))
    const next = new Set(cur)
    for (const id of ids) {
      if (allExcluded) next.delete(id)
      else next.add(id)
    }
    void apply({ excludedChapters: [...next] })
  }

  const togglePin = (ids: string[]) => {
    if (!settings) return
    const cur = new Set(settings.pinnedChapters)
    const allPinned = ids.every((i) => cur.has(i))
    const next = new Set(cur)
    for (const id of ids) {
      if (allPinned) next.delete(id)
      else next.add(id)
    }
    void apply({ pinnedChapters: [...next] })
  }

  async function refreshSegments() {
    if (!projectId) return
    setSegBusy(true)
    setMessage(null)
    try {
      const r = await apiRefreshSegments(projectId)
      if (!r.started) {
        setMessage('已有压缩任务在进行中')
        setSegBusy(false)
        return
      }
      // 后台压缩：轮询进度，完成后刷新结构图
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 3000))
        const { progress } = await apiSegmentProgress(projectId)
        setMessage(`压缩中 ${progress.done}/${progress.total} 段（成功 ${progress.generated}，失败 ${progress.failed}）`)
        if (!progress.running) break
      }
      await load()
      const { progress } = await apiSegmentProgress(projectId)
      setMessage(`压缩完成：成功 ${progress.generated} 段，失败 ${progress.failed} 段`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '压缩失败')
    } finally {
      setSegBusy(false)
    }
  }

  if (!projectId) return null

  const chapterCount = (list: ContextChainEntry[], includedOnly: boolean) =>
    list
      .filter((c) => (includedOnly ? c.included : true))
      .reduce((s, c) => s + (c.segment ? c.segment.chapterIds.length : 1), 0)

  const includedChapters = chapterCount(chain, true)
  const allChapters = chapterCount(chain, false)
  const llmSegments = chain.filter((c) => c.segment?.source === 'llm').length

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto">
      <div className="muted text-[12px]">
        每次提词会组装这些内容。关闭不需要的块可以省上下文；把重要章节「固定」会让它始终以完整摘要进入。
        远处章节不再逐章罗列，而是每 {settings?.groupSize ?? 3} 章压缩成一段。
      </div>

      <div className="flex gap-1">
        <span className={`tab ${view === 'tree' ? 'active' : ''}`} onClick={() => setView('tree')}>
          结构图
        </span>
        <span className={`tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
          链条列表
        </span>
      </div>

      <div className="rounded-md p-2 text-[12px]" style={{ background: 'var(--bg)' }}>
        合计约 {total} 字 · 前情链条纳入 {includedChapters}/{allChapters} 章（{chain.filter((c) => c.included).length} 条
        {llmSegments > 0 ? `，其中 ${llmSegments} 条为模型压缩` : ''}）
      </div>

      <div>
        <div className="mb-1 text-[12px] muted">上下文块（点击开关）</div>
        {blocks.map((b) => (
          <label key={b.key} className="flex items-center gap-2 py-0.5 text-[12px]">
            <input type="checkbox" checked={b.enabled} onChange={() => toggleBlock(b.key)} disabled={busy} />
            <span className="min-w-0 flex-1 truncate">{b.label}</span>
            <span className="muted">{b.chars} 字</span>
          </label>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[12px] muted">远段合段</span>
          <span className="flex-1" />
          {GROUP_OPTIONS.map((n) => (
            <button
              key={n}
              className={`btn px-1.5 py-0.5 text-[12px] ${settings?.groupSize === n ? 'btn-primary' : ''}`}
              disabled={busy}
              onClick={() => void apply({ groupSize: n })}
            >
              {n} 章
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <button className="btn whitespace-nowrap text-[12px]" disabled={segBusy} onClick={() => void refreshSegments()}>
            {segBusy ? '压缩中…' : '重新压缩远段'}
          </button>
          <span className="muted text-[11px]">用强模型把每段的几章压成一段话（后台也会在摘要生成后自动压缩）</span>
        </div>
        {message && <div className="muted mb-2 text-[12px]">{message}</div>}
      </div>

      {view === 'tree' && tree && settings && (
        <ContextTreeGraph tree={tree} settings={settings} busy={busy} onPatch={(patch) => void apply(patch)} />
      )}

      <div style={{ display: view === 'list' ? undefined : 'none' }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] muted">前情链条（近详远略）</span>
          <span className="muted text-[11px]">固定 = 始终用完整摘要</span>
        </div>
        {chain.length === 0 && <div className="muted text-[12px]">当前章之前没有其他章节</div>}
        {chain.map((c) => {
          const ids = idsOf(c)
          const excluded = ids.every((i) => settings?.excludedChapters.includes(i))
          const pinned = ids.every((i) => settings?.pinnedChapters.includes(i))
          return (
            <div
              key={c.chapterId}
              className="mb-1 rounded-md p-2 text-[12px]"
              style={{
                border: '1px solid var(--border)',
                opacity: c.included ? 1 : 0.55,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {c.segment
                    ? `第${c.segment.startOrder}–${c.segment.endOrder}章（合 ${c.segment.chapterIds.length} 章）`
                    : `第${c.order}章《${c.title}》`}
                </span>
                {c.segment && (
                  <span className="tag">{c.segment.source === 'llm' ? '模型压缩' : '摘要拼接'}</span>
                )}
                <span className="tag">{TIER_LABELS[c.tier] ?? c.tier}</span>
                <span className="muted">{c.chars} 字</span>
              </div>
              {c.text && <div className="muted mt-1 line-clamp-2">{c.text}</div>}
              {c.reason && <div className="muted mt-1">未纳入：{c.reason}</div>}
              <div className="mt-1 flex items-center gap-2">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!excluded}
                    onChange={() => toggleExclude(ids)}
                    disabled={busy}
                  />
                  纳入{c.segment ? `（${ids.length} 章）` : ''}
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={() => togglePin(ids)}
                    disabled={busy}
                  />
                  固定
                </label>
                <span className="flex-1" />
                <span className="muted">距离 {c.distance} 章</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
