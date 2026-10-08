import { useEffect, useState } from 'react'
import ChapterList from './components/ChapterList'
import EditorPane from './components/EditorPane'
import LorePanel from './components/LorePanel'
import StatusBar from './components/StatusBar'
import StylePanel from './components/StylePanel'
import SummaryPanel from './components/SummaryPanel'
import SettingsDialog from './components/SettingsDialog'
import { apiExportUrl } from './api/client'
import { getLastProjectId, useStore } from './store/useStore'

export default function App() {
  const detail = useStore((s) => s.detail)
  const init = useStore((s) => s.init)
  const openProject = useStore((s) => s.openProject)
  const refreshJobs = useStore((s) => s.refreshJobs)
  const [booted, setBooted] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    init()
      .then(async () => {
        const last = getLastProjectId()
        if (last && !cancelled) {
          try {
            await openProject(last)
          } catch {
            localStorage.removeItem('writerai-last-project')
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setBootError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setBooted(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 后台任务轮询
  useEffect(() => {
    if (!detail) return
    const t = setInterval(() => void refreshJobs(), 15000)
    void refreshJobs()
    return () => clearInterval(t)
  }, [detail?.project.id])

  if (!booted) {
    return <div className="flex h-full items-center justify-center muted">加载中…</div>
  }

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="panel p-6 text-center">
          <div className="mb-2" style={{ color: '#dc2626' }}>无法连接后端</div>
          <div className="muted text-[13px]">请确认后端服务已启动（npm run dev / npm start）。{bootError}</div>
        </div>
      </div>
    )
  }

  return detail ? <EditorPage /> : <ProjectListPage />
}

function ProjectListPage() {
  const projects = useStore((s) => s.projects)
  const createProject = useStore((s) => s.createProject)
  const openProject = useStore((s) => s.openProject)
  const deleteProject = useStore((s) => s.deleteProject)
  const [title, setTitle] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="font-semibold">WriterAI</span>
        <span className="flex-1" />
        <button className="btn" onClick={() => setShowSettings(true)} title="模型、提词与云同步设置">
          ⚙ 设置
        </button>
      </div>
    <div className="mx-auto flex min-h-0 flex-1 w-full max-w-[640px] flex-col justify-center px-6">
      <h1 className="mb-1 text-[28px] font-bold">WriterAI 小说提词器</h1>
      <p className="muted mb-6 text-[13px]">
        停顿片刻，AI 结合设定与前情，在光标处给出灰色提示。Tab 接受，Esc 忽略。
      </p>
      <div className="panel mb-6 p-4">
        <div className="mb-2 font-medium">新建项目</div>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="小说名称"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) void createProject(title.trim())
            }}
          />
          <button
            className="btn btn-primary shrink-0"
            disabled={!title.trim()}
            onClick={() => {
              void createProject(title.trim())
              setTitle('')
            }}
          >
            创建
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {projects.map((p) => (
          <div key={p.id} className="panel flex items-center gap-3 p-3">
            <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
            <span className="muted text-[12px]">{new Date(p.updated_at).toLocaleString()}</span>
            <button className="btn" onClick={() => void openProject(p.id)}>
              打开
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (confirm(`删除项目《${p.title}》及其全部章节与设定？`)) void deleteProject(p.id)
              }}
            >
              删除
            </button>
          </div>
        ))}
        {projects.length === 0 && <div className="muted text-center text-[13px]">还没有项目，先创建一个吧（也可在设置里从云端恢复）</div>}
      </div>
    </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}

type RightTab = 'lore' | 'summary' | 'style'

function EditorPage() {
  const project = useStore((s) => s.detail!.project)
  const closeProject = useStore((s) => s.closeProject)
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)
  const [tab, setTab] = useState<RightTab>('lore')
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center gap-3 px-4 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <button className="btn" onClick={closeProject}>
          ← 项目
        </button>
        <span className="font-semibold">{project.title}</span>
        <span className="flex-1" />
        <a className="btn" href={apiExportUrl(project.id, 'txt')} download>
          导出 txt
        </a>
        <a className="btn" href={apiExportUrl(project.id, 'md')} download>
          导出 md
        </a>
        <button className="btn" onClick={() => setShowSettings(true)}>
          ⚙ 设置
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 p-3" style={{ borderRight: '1px solid var(--border)' }}>
          <div className="mb-2 text-[12px] font-semibold muted">章节</div>
          <div className="h-[calc(100%-28px)]">
            <ChapterList />
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4">
          {/* 按章节 id 重挂载，确保编辑器内容与章节严格对应（避免残留上一章内容） */}
          <EditorPane key={activeChapterId ?? 'none'} />
        </main>

        <aside className="w-80 shrink-0 p-3" style={{ borderLeft: '1px solid var(--border)' }}>
          <div className="mb-2 flex gap-1">
            <span className={`tab ${tab === 'lore' ? 'active' : ''}`} onClick={() => setTab('lore')}>
              设定
            </span>
            <span className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
              前情
            </span>
            <span className={`tab ${tab === 'style' ? 'active' : ''}`} onClick={() => setTab('style')}>
              风格
            </span>
          </div>
          <div className="h-[calc(100%-36px)]">
            {tab === 'lore' && <LorePanel />}
            {tab === 'summary' && <SummaryPanel />}
            {tab === 'style' && <StylePanel />}
          </div>
        </aside>
      </div>

      <StatusBar />

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}
