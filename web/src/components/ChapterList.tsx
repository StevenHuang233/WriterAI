import { useState } from 'react'
import { useStore } from '../store/useStore'

export default function ChapterList() {
  const chapters = useStore((s) => (s.detail ? [...s.detail.chapters].sort((a, b) => a.sort_order - b.sort_order) : []))
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)
  const createChapter = useStore((s) => s.createChapter)
  const setActiveChapter = useStore((s) => s.setActiveChapter)
  const renameChapter = useStore((s) => s.renameChapter)
  const deleteChapter = useStore((s) => s.deleteChapter)
  const moveChapter = useStore((s) => s.moveChapter)
  const [newTitle, setNewTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  async function handleCreate() {
    const title = newTitle.trim()
    if (!title) return
    await createChapter(title)
    setNewTitle('')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex gap-1">
        <input
          className="input"
          placeholder="新章节标题"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
        />
        <button className="btn btn-primary shrink-0" onClick={() => void handleCreate()} disabled={!newTitle.trim()}>
          +
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {chapters.map((ch, i) => {
          const active = ch.id === activeChapterId
          return (
            <div
              key={ch.id}
              className="group mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer text-[13px]"
              style={{
                background: active ? 'var(--bg)' : 'transparent',
                fontWeight: active ? 600 : 400,
              }}
              onClick={() => void setActiveChapter(ch.id)}
            >
              {renamingId === ch.id ? (
                <input
                  className="input"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => {
                    if (renameText.trim()) void renameChapter(ch.id, renameText.trim())
                    setRenamingId(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate" onDoubleClick={() => { setRenamingId(ch.id); setRenameText(ch.title) }}>
                    {ch.sort_order}. {ch.title}
                  </span>
                  <span className="muted shrink-0 text-[11px]">{ch.content_length}字</span>
                  <span className="hidden shrink-0 gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                    <button className="btn px-1.5 py-0" title="上移" onClick={() => void moveChapter(ch.id, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button className="btn px-1.5 py-0" title="下移" onClick={() => void moveChapter(ch.id, 1)} disabled={i === chapters.length - 1}>
                      ↓
                    </button>
                    <button
                      className="btn btn-danger px-1.5 py-0"
                      title="删除"
                      onClick={() => {
                        if (confirm(`删除《${ch.title}》？此操作不可恢复。`)) void deleteChapter(ch.id)
                      }}
                    >
                      ×
                    </button>
                  </span>
                </>
              )}
            </div>
          )
        })}
        {chapters.length === 0 && <div className="muted p-2 text-[12px]">暂无章节</div>}
      </div>
    </div>
  )
}
