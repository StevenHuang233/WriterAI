import { useEffect, useState } from 'react'
import {
  apiContextSettings, apiContextPreview, apiSaveContextSettings,
  type ContextBlock, type ContextChainEntry, type ContextSettings,
} from '../api/client'
import { useStore } from '../store/useStore'

const TIER_LABELS: Record<string, string> = {
  full: '完整摘要',
  brief: '一句话',
  micro: '极简',
}

export default function ContextPanel() {
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)
  const [settings, setSettings] = useState<ContextSettings | null>(null)
  const [blocks, setBlocks] = useState<ContextBlock[]>([])
  const [chain, setChain] = useState<ContextChainEntry[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!projectId) return
    const r = await apiContextPreview(projectId, activeChapterId ?? undefined)
    setSettings(r.settings)
    setBlocks(r.blocks)
    setChain(r.chain)
    setTotal(r.totalChars)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeChapterId])

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

  const toggleExclude = (id: string) => {
    if (!settings) return
    const has = settings.excludedChapters.includes(id)
    void apply({
      excludedChapters: has
        ? settings.excludedChapters.filter((k) => k !== id)
        : [...settings.excludedChapters, id],
    })
  }

  const togglePin = (id: string) => {
    if (!settings) return
    const has = settings.pinnedChapters.includes(id)
    void apply({
      pinnedChapters: has
        ? settings.pinnedChapters.filter((k) => k !== id)
        : [...settings.pinnedChapters, id],
    })
  }

  if (!projectId) return null
  const included = chain.filter((c) => c.included).length

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto">
      <div className="muted text-[12px]">
        每次提词会组装这些内容。关闭不需要的块可以省上下文；把重要章节「固定」会让它始终以完整摘要进入。
      </div>

      <div className="rounded-md p-2 text-[12px]" style={{ background: 'var(--bg)' }}>
        合计约 {total} 字 · 前情链条纳入 {included}/{chain.length} 章
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
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] muted">前情链条（近详远略）</span>
          <span className="muted text-[11px]">固定 = 始终用完整摘要</span>
        </div>
        {chain.length === 0 && <div className="muted text-[12px]">当前章之前没有其他章节</div>}
        {chain.map((c) => (
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
                第{c.order}章《{c.title}》
              </span>
              <span className="tag">{TIER_LABELS[c.tier] ?? c.tier}</span>
              <span className="muted">{c.chars} 字</span>
            </div>
            {c.text && <div className="muted mt-1 line-clamp-2">{c.text}</div>}
            {c.reason && <div className="muted mt-1">未纳入：{c.reason}</div>}
            <div className="mt-1 flex items-center gap-2">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!settings?.excludedChapters.includes(c.chapterId)}
                  onChange={() => toggleExclude(c.chapterId)}
                  disabled={busy}
                />
                纳入
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={settings?.pinnedChapters.includes(c.chapterId) ?? false}
                  onChange={() => togglePin(c.chapterId)}
                  disabled={busy}
                />
                固定
              </label>
              <span className="flex-1" />
              <span className="muted">距离 {c.distance} 章</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
