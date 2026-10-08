import { useState } from 'react'
import { apiReplace, apiSearch, type SearchMatch } from '../api/client'
import { useStore } from '../store/useStore'

export default function SearchPanel() {
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const setActiveChapter = useStore((s) => s.setActiveChapter)
  const setJumpTarget = useStore((s) => s.setJumpTarget)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function runSearch() {
    if (!projectId || !query.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await apiSearch(projectId, query.trim())
      setMatches(r.matches)
      setTotal(r.total)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function jump(m: SearchMatch, occurrence: number) {
    setJumpTarget({ chapterId: m.chapterId, query: query.trim(), occurrence })
    await setActiveChapter(m.chapterId)
  }

  async function replaceAll() {
    if (!projectId || !query.trim()) return
    if (!confirm(`把全部“${query.trim()}”替换为“${replacement}”？替换前会自动保存版本，可在「历史」里回退。`)) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await apiReplace(projectId, { query: query.trim(), replacement })
      setMessage(`已替换 ${r.replacements} 处，涉及 ${r.chapters} 章`)
      setMatches([])
      setTotal(null)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!projectId) return null

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-1">
        <input
          className="input"
          placeholder="搜索（跨全部章节）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
        />
        <button className="btn btn-primary shrink-0" onClick={() => void runSearch()} disabled={busy || !query.trim()}>
          搜索
        </button>
      </div>

      <div className="flex gap-1">
        <input
          className="input"
          placeholder="替换为（留空则删除）"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
        <button className="btn shrink-0" onClick={() => void replaceAll()} disabled={busy || !query.trim()}>
          全部替换
        </button>
      </div>

      {total !== null && (
        <div className="muted text-[12px]">
          共 {total} 处匹配{total > matches.length ? `（显示前 ${matches.length} 条）` : ''}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {matches.map((m, i) => (
          <div
            key={`${m.chapterId}-${m.index}`}
            className="mb-1 cursor-pointer rounded-md p-2 text-[12px]"
            style={{ border: '1px solid var(--border)' }}
            onClick={() => void jump(m, i)}
          >
            <div className="muted mb-1">{m.title}</div>
            <div>…{m.preview}…</div>
          </div>
        ))}
        {total === 0 && <div className="muted p-2 text-[12px]">没有找到</div>}
      </div>

      {message && <div className="text-[12px]" style={{ color: 'var(--accent)' }}>{message}</div>}
    </div>
  )
}
