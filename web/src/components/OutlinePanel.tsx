import { useRef } from 'react'
import { useStore } from '../store/useStore'

export default function OutlinePanel() {
  const chapters = useStore((s) => s.detail?.chapters)
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)
  const updateChapterOutline = useStore((s) => s.updateChapterOutline)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const list = chapters ? [...chapters].sort((a, b) => a.sort_order - b.sort_order) : []

  function schedule(id: string, outline: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void updateChapterOutline(id, outline)
    }, 800)
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto">
      <div className="muted text-[12px]">
        每章写几句细纲，提词时会带上本章大纲，让 AI 朝你设定的方向推进。
      </div>
      {list.map((ch) => (
        <div key={ch.id} className="rounded-md p-2" style={{ border: '1px solid var(--border)' }}>
          <div className="mb-1 flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate font-medium">
              {ch.sort_order}. {ch.title}
            </span>
            {ch.id === activeChapterId && <span className="tag" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>当前</span>}
          </div>
          <textarea
            className="textarea"
            rows={3}
            defaultValue={ch.outline ?? ''}
            key={`outline-${ch.id}`}
            placeholder="例：林墨在酒馆遇上旧识，得知三年前旧案的线索；结尾留下门外之人的悬念。"
            onChange={(e) => schedule(ch.id, e.target.value)}
          />
        </div>
      ))}
      {list.length === 0 && <div className="muted text-[12px]">还没有章节</div>}
    </div>
  )
}
