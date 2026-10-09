import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'

interface Props {
  onClose: () => void
}

type Format = 'txt' | 'md' | 'html' | 'docx' | 'zip'
type Template = 'cn' | 'num' | 'dot' | 'plain'
type Scope = 'all' | 'chapter' | 'current'

const FORMATS: { id: Format; name: string; hint: string; copyable: boolean }[] = [
  { id: 'txt', name: 'TXT', hint: '网文平台后台粘贴、上传', copyable: true },
  { id: 'md', name: 'Markdown', hint: '简书 / 知乎 / 自建博客', copyable: true },
  { id: 'html', name: 'HTML', hint: '自建博客、静态站点', copyable: true },
  { id: 'docx', name: 'Word (.docx)', hint: '投稿、给编辑看', copyable: false },
  { id: 'zip', name: '分章 ZIP', hint: '每章一个 txt，批量上传', copyable: false },
]

const TEMPLATES: { id: Template; name: string; sample: string }[] = [
  { id: 'cn', name: '第一章 雨夜', sample: '第X章（中文数字）' },
  { id: 'num', name: '第1章 雨夜', sample: '第N章（阿拉伯数字）' },
  { id: 'dot', name: '1. 雨夜', sample: '数字加点' },
  { id: 'plain', name: '雨夜', sample: '只用标题' },
]

export default function ExportDialog({ onClose }: Props) {
  const project = useStore((s) => s.detail?.project)
  const chaptersRaw = useStore((s) => s.detail?.chapters)
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)

  const chapters = useMemo(
    () => (chaptersRaw ? [...chaptersRaw].sort((a, b) => a.sort_order - b.sort_order) : []),
    [chaptersRaw],
  )

  const [format, setFormat] = useState<Format>('txt')
  const [template, setTemplate] = useState<Template>('cn')
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [frontMatter, setFrontMatter] = useState(false)
  const [splitLong, setSplitLong] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  if (!project) return null

  const scopeIds =
    scope === 'all' ? [] : scope === 'current' ? (activeChapterId ? [activeChapterId] : []) : selected

  function buildUrl(download: boolean): string {
    const params = new URLSearchParams({
      format,
      titleTemplate: template,
      ...(frontMatter ? { frontMatter: '1' } : {}),
      ...(splitLong ? { splitLong: '1' } : {}),
      download: download ? '1' : '0',
    })
    if (scope !== 'all') {
      params.set('scope', 'chapter')
      params.set('chapterIds', scopeIds.join(','))
    } else {
      params.set('scope', 'all')
    }
    return `/api/projects/${project!.id}/export?${params.toString()}`
  }

  async function copyText() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(buildUrl(false))
      if (!res.ok) throw new Error(`导出失败 ${res.status}`)
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setMessage({ ok: true, text: `已复制 ${text.length} 字到剪贴板，可直接粘贴到平台后台` })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const currentFormat = FORMATS.find((f) => f.id === format)!
  const canExport = scope === 'all' || scopeIds.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="panel w-[560px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[15px] font-semibold">导出 / 发布</span>
          <button className="btn px-2 py-0.5" onClick={onClose}>×</button>
        </div>

        <div className="mb-3">
          <div className="mb-1 text-[12px] muted">格式</div>
          <div className="flex flex-wrap gap-1">
            {FORMATS.map((f) => (
              <span key={f.id} className={`tab ${format === f.id ? 'active' : ''}`} onClick={() => setFormat(f.id)}>
                {f.name}
              </span>
            ))}
          </div>
          <div className="muted mt-1 text-[12px]">{currentFormat.hint}</div>
        </div>

        <div className="mb-3">
          <div className="mb-1 text-[12px] muted">范围</div>
          <div className="flex gap-1">
            <span className={`tab ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')}>
              全书（{chapters.length} 章）
            </span>
            <span
              className={`tab ${scope === 'current' ? 'active' : ''}`}
              onClick={() => setScope('current')}
            >
              当前章
            </span>
            <span className={`tab ${scope === 'chapter' ? 'active' : ''}`} onClick={() => setScope('chapter')}>
              选择章节
            </span>
          </div>
          {scope === 'chapter' && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md p-2" style={{ border: '1px solid var(--border)' }}>
              {chapters.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-0.5 text-[12px]">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((id) => id !== c.id)))
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {c.sort_order}. {c.title}
                  </span>
                  <span className="muted">{c.content_length} 字</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="mb-3">
          <div className="mb-1 text-[12px] muted">章节标题格式</div>
          <div className="flex flex-wrap gap-1">
            {TEMPLATES.map((t) => (
              <span key={t.id} className={`tab ${template === t.id ? 'active' : ''}`} onClick={() => setTemplate(t.id)}>
                {t.name}
              </span>
            ))}
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-1">
          {format === 'md' && (
            <label className="flex items-center gap-1 text-[12px]">
              <input type="checkbox" checked={frontMatter} onChange={(e) => setFrontMatter(e.target.checked)} />
              加 YAML front matter（标题 / 日期，便于博客发布）
            </label>
          )}
          <label className="flex items-center gap-1 text-[12px]">
            <input type="checkbox" checked={splitLong} onChange={(e) => setSplitLong(e.target.checked)} />
            过长段落自动拆分（手机阅读更舒服）
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="muted flex-1 text-[12px]">
            {canExport ? `将导出 ${scope === 'all' ? chapters.length : scopeIds.length} 章` : '请先选择章节'}
          </span>
          {currentFormat.copyable && (
            <button className="btn" onClick={() => void copyText()} disabled={!canExport || busy}>
              {busy ? '处理中…' : '复制到剪贴板'}
            </button>
          )}
          <a
            className={`btn btn-primary ${canExport ? '' : 'pointer-events-none opacity-50'}`}
            href={buildUrl(true)}
            download
          >
            下载文件
          </a>
        </div>

        {message && (
          <div className="mt-2 text-[12px]" style={{ color: message.ok ? 'var(--accent)' : '#dc2626' }}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  )
}
