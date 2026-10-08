import { useState } from 'react'
import { apiImport } from '../api/client'
import { useStore } from '../store/useStore'
import type { ImportMode } from '../types'

interface Props {
  onClose: () => void
}

const MODES: { id: ImportMode; name: string; hint: string }[] = [
  { id: 'md-heading', name: 'Markdown 标题', hint: '按 # / ## 等标题行分章' },
  { id: 'chapter-regex', name: '“第X章”标题', hint: '按“第一章”“第 2 章”这类标题行分章' },
  { id: 'single', name: '整篇作为一章', hint: '不拆分，全部内容放入一个新章节' },
]

export default function ImportDialog({ onClose }: Props) {
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const openProject = useStore((s) => s.openProject)
  const [mode, setMode] = useState<ImportMode>('md-heading')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function runImport() {
    if (!projectId || !text.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await apiImport(projectId, { text, mode })
      setMessage({ ok: true, text: `已导入 ${r.chapters} 章：${r.titles.slice(0, 5).join('、')}${r.titles.length > 5 ? '…' : ''}` })
      setText('')
      // 刷新章节列表
      await openProject(projectId)
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="panel w-[560px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[15px] font-semibold">导入稿件</span>
          <button className="btn px-2 py-0.5" onClick={onClose}>×</button>
        </div>

        <div className="mb-2 flex flex-wrap gap-1">
          {MODES.map((m) => (
            <span key={m.id} className={`tab ${mode === m.id ? 'active' : ''}`} onClick={() => setMode(m.id)}>
              {m.name}
            </span>
          ))}
        </div>
        <div className="muted mb-2 text-[12px]">{MODES.find((m) => m.id === mode)?.hint}</div>

        <textarea
          className="textarea mb-3"
          rows={12}
          placeholder="把 Markdown 或纯文本粘贴到这里"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="flex items-center gap-2">
          <span className="muted text-[12px] flex-1">导入会新建章节，不会覆盖已有内容</span>
          <button className="btn" onClick={onClose}>关闭</button>
          <button className="btn btn-primary" onClick={() => void runImport()} disabled={busy || !text.trim()}>
            {busy ? '导入中…' : `导入（约 ${countChapters(text, mode)} 章）`}
          </button>
        </div>

        {message && (
          <div className="mt-2 text-[12px]" style={{ color: message.ok ? 'var(--accent)' : '#dc2626' }}>
            {message.text}
          </div>
        )}
        {!projectId && <div className="mt-2 text-[12px]" style={{ color: '#dc2626' }}>请先打开一个项目</div>}
        <div className="mt-1 text-[12px] muted">导入会新建章节，不会覆盖已有内容</div>
      </div>
    </div>
  )
}

function countChapters(text: string, mode: string): number {
  if (!text.trim()) return 0
  if (mode === 'single') return 1
  const lines = text.split('\n')
  if (mode === 'md-heading') return lines.filter((l) => /^\s{0,3}#{1,6}\s+/.test(l)).length || 1
  return lines.filter((l) => /^\s*第[0-9一二三四五六七八九十百千零〇]+[章节回篇]/.test(l)).length || 1
}
