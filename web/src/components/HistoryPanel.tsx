import { useEffect, useState } from 'react'
import { apiCreateSnapshot, apiRestoreSnapshot, apiSnapshots, type SnapshotMeta } from '../api/client'
import { useStore } from '../store/useStore'

export default function HistoryPanel() {
  const chapterId = useStore((s) => s.activeChapter?.id ?? null)
  const chapterTitle = useStore((s) => s.activeChapter?.title ?? '')
  const currentLen = useStore((s) => s.activeChapter?.content.length ?? 0)
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const openProject = useStore((s) => s.openProject)
  const setActiveChapter = useStore((s) => s.setActiveChapter)
  const [snaps, setSnaps] = useState<SnapshotMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    if (!chapterId) return
    try {
      setSnaps(await apiSnapshots(chapterId))
    } catch {
      setSnaps([])
    }
  }

  useEffect(() => {
    void load()
  }, [chapterId])

  async function saveVersion() {
    if (!chapterId) return
    setBusy(true)
    try {
      const r = await apiCreateSnapshot(chapterId, '手动保存')
      setSnaps(r.snapshots)
      setMessage('已保存当前版本')
    } finally {
      setBusy(false)
    }
  }

  async function restore(id: string) {
    if (!confirm('恢复到这个版本？当前内容会先自动存为一个版本，不会丢失。')) return
    setBusy(true)
    setMessage(null)
    try {
      await apiRestoreSnapshot(id)
      setMessage('已恢复')
      // 原地重新加载该章节，避免整页刷新把用户踢回项目列表
      if (projectId && chapterId) {
        await openProject(projectId)
        await setActiveChapter(chapterId)
      }
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!chapterId) return <div className="muted text-[12px]">请先选择一个章节</div>

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] muted min-w-0 flex-1 truncate">{chapterTitle}（当前 {currentLen} 字）</span>
        <button className="btn shrink-0" onClick={() => void saveVersion()} disabled={busy}>
          保存当前版本
        </button>
      </div>

      <div className="muted text-[12px]">
        写满 500 字或每 5 分钟自动留版本，最多保留最近 30 个
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {snaps.map((s) => (
          <div
            key={s.id}
            className="mb-1 flex items-center gap-2 rounded-md p-2 text-[12px]"
            style={{ border: '1px solid var(--border)' }}
          >
            <span className="min-w-0 flex-1 truncate">
              {new Date(s.created_at).toLocaleString()} · {s.label} · {s.length} 字
            </span>
            <span className="muted shrink-0">
              {s.length - currentLen > 0 ? `+${s.length - currentLen}` : s.length - currentLen}
            </span>
            <button className="btn px-2 py-0.5 shrink-0" onClick={() => void restore(s.id)} disabled={busy}>
              恢复
            </button>
          </div>
        ))}
        {snaps.length === 0 && <div className="muted p-2 text-[12px]">还没有历史版本</div>}
      </div>

      {message && <div className="text-[12px]" style={{ color: 'var(--accent)' }}>{message}</div>}
    </div>
  )
}
