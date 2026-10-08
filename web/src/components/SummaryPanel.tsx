import { useState } from 'react'
import { apiRebuildSummary, apiSummarizeChapter } from '../api/client'
import { useStore } from '../store/useStore'

export default function SummaryPanel() {
  const detail = useStore((s) => s.detail)
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)
  const updateProject = useStore((s) => s.updateProject)
  const setChapterSummary = useStore((s) => s.setChapterSummary)
  const openProject = useStore((s) => s.openProject)
  const refreshJobs = useStore((s) => s.refreshJobs)
  const jobs = useStore((s) => s.jobs)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!detail) return null
  const chapters = [...detail.chapters].sort((a, b) => a.sort_order - b.sort_order)

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function patchSynopsis(value: string) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void updateProject({ synopsis: value })
    }, 800)
  }

  async function rebuild() {
    if (!detail) return
    setBusy(true)
    setMessage(null)
    try {
      await apiRebuildSummary(detail.project.id)
      setMessage('梗概已重建')
      await openProject(detail.project.id)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '重建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div>
        <div className="mb-1 text-[12px] muted">故事简介（常驻上下文）</div>
        <textarea
          className="textarea"
          rows={3}
          defaultValue={detail.project.synopsis}
          key={`synopsis-${detail.project.id}`}
          onChange={(e) => patchSynopsis(e.target.value)}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] muted">全书梗概（AI 滚动更新，可手动修改）</span>
          <button className="btn px-2 py-0.5 text-[12px]" onClick={() => void rebuild()} disabled={busy}>
            从章节摘要重建
          </button>
        </div>
        <textarea
          className="textarea"
          rows={6}
          defaultValue={detail.project.global_summary}
          key={`global-${detail.project.id}-${detail.project.global_summary.length}`}
          onBlur={(e) => {
            if (e.target.value !== detail.project.global_summary) void updateProject({ global_summary: e.target.value })
          }}
        />
        {message && <div className="mt-1 text-[12px] muted">{message}</div>}
      </div>

      <div className="min-h-0 flex-1">
        <div className="mb-1 text-[12px] muted">章节摘要（编辑后自动锁定，AI 不再覆盖）</div>
        {chapters.map((ch) => (
          <div key={ch.id} className="mb-2 rounded-md p-2" style={{ border: '1px solid var(--border)' }}>
            <div className="mb-1 flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-medium">
                {ch.sort_order}. {ch.title}
              </span>
              {ch.summary_locked === 1 && <span className="tag" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>已锁定</span>}
              <button
                className="btn px-2 py-0.5"
                onClick={async () => {
                  try {
                    await apiSummarizeChapter(ch.id)
                    setMessage(`《${ch.title}》已加入摘要队列`)
                    void refreshJobs()
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : '提交失败')
                  }
                }}
              >
                立即摘要
              </button>
              {ch.summary_locked === 1 && (
                <button className="btn px-2 py-0.5" onClick={() => void setChapterSummary(ch.id, ch.summary, false)}>
                  解锁
                </button>
              )}
            </div>
            <textarea
              className="textarea"
              rows={3}
              defaultValue={ch.summary}
              key={`summary-${ch.id}-${ch.summary}`}
              placeholder={ch.id === activeChapterId ? '（当前章，切换章节或写满 1500 字后自动生成）' : '（暂无摘要）'}
              onBlur={(e) => {
                if (e.target.value !== ch.summary) void setChapterSummary(ch.id, e.target.value)
              }}
            />
          </div>
        ))}
      </div>

      {jobs.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] muted">后台任务</div>
          {jobs.slice(0, 5).map((j) => (
            <div key={j.chapterId + j.updatedAt} className="mb-1 flex items-center gap-2 text-[12px]">
              <span className="tag">{j.status === 'done' ? '完成' : j.status === 'running' ? '进行中' : j.status === 'pending' ? '排队中' : '失败'}</span>
              <span className="min-w-0 flex-1 truncate">
                {j.chapterTitle}
                {j.updates && j.updates.length > 0 && ` · 更新了 ${j.updates.map((u) => u.name).join('、')} 的状态`}
              </span>
              {j.error && <span style={{ color: '#dc2626' }}>{j.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
