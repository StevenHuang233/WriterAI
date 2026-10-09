import { useEffect, useMemo, useState } from 'react'
import ChapterList from './components/ChapterList'
import EditorPane from './components/EditorPane'
import LorePanel from './components/LorePanel'
import StatusBar from './components/StatusBar'
import StylePanel from './components/StylePanel'
import SummaryPanel from './components/SummaryPanel'
import OutlinePanel from './components/OutlinePanel'
import StatsPanel from './components/StatsPanel'
import SearchPanel from './components/SearchPanel'
import HistoryPanel from './components/HistoryPanel'
import ImportDialog from './components/ImportDialog'
import ExportDialog from './components/ExportDialog'
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

type RightTab = 'lore' | 'outline' | 'summary' | 'style' | 'stats' | 'search' | 'history'

const RIGHT_TABS: { id: RightTab; name: string }[] = [
  { id: 'lore', name: '设定' },
  { id: 'outline', name: '大纲' },
  { id: 'summary', name: '前情' },
  { id: 'style', name: '风格' },
  { id: 'stats', name: '统计' },
  { id: 'search', name: '搜索' },
  { id: 'history', name: '历史' },
]

function EditorPage() {
  const project = useStore((s) => s.detail!.project)
  const closeProject = useStore((s) => s.closeProject)
  const activeChapterId = useStore((s) => s.activeChapter?.id ?? null)
  const editorReloadToken = useStore((s) => s.editorReloadToken)
  const setActiveChapter = useStore((s) => s.setActiveChapter)
  // 选择器必须返回稳定引用，排序放 useMemo（否则会陷入无限重渲染）
  const chaptersRaw = useStore((s) => s.detail?.chapters)
  const chapterOptions = useMemo(
    () => (chaptersRaw ? [...chaptersRaw].sort((a, b) => a.sort_order - b.sort_order) : []),
    [chaptersRaw],
  )
  const [showRightPanel, setShowRightPanel] = useState(() => window.innerWidth >= 1100)
  const [panelManual, setPanelManual] = useState(false)

  // 窄窗口自动收起右侧面板；用户手动切换过之后不再自动干预
  useEffect(() => {
    const onResize = () => {
      if (panelManual) return
      setShowRightPanel(window.innerWidth >= 1100)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [panelManual])
  const [tab, setTab] = useState<RightTab>('lore')
  const [showSettings, setShowSettings] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

  // Cmd/Ctrl+F 打开搜索面板（并阻止浏览器默认查找，避免抢走焦点）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setTab('search')
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>('input[placeholder="搜索（跨全部章节）"]')
          input?.focus()
        }, 50)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        <select
          className="select w-auto max-w-[180px]"
          value={activeChapterId ?? ''}
          onChange={(e) => { if (e.target.value) void setActiveChapter(e.target.value) }}
          title="快速跳转到章节"
        >
          {chapterOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.sort_order}. {c.title}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button
          className="btn"
          onClick={() => {
            setPanelManual(true)
            setShowRightPanel((v) => !v)
          }}
          title="隐藏 / 显示右侧面板（窄屏或专注写作）"
        >
          {showRightPanel ? '隐藏面板' : '显示面板'}
        </button>
        <button className="btn btn-primary" onClick={() => setShowExport(true)} title="导出为 txt / Markdown / HTML / Word / 分章 ZIP">
          导出 / 发布
        </button>
        <button className="btn" onClick={() => setShowImport(true)} title="从 Markdown 或纯文本导入章节">
          导入
        </button>
        <button className="btn" onClick={() => setShowSettings(true)}>
          ⚙ 设置
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-44 shrink-0 p-3 sm:block md:w-52" style={{ borderRight: '1px solid var(--border)' }}>
          <div className="mb-2 text-[12px] font-semibold muted">章节</div>
          <div className="h-[calc(100%-28px)]">
            <ChapterList />
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4">
          {/* 按章节 id + 重载计数 重挂载：切换章节或外部改动正文后都强制刷新编辑器 */}
          <EditorPane key={`${activeChapterId ?? 'none'}:${editorReloadToken}`} />
        </main>

        {showRightPanel && (
        <aside className="w-72 shrink-0 p-3 xl:w-80" style={{ borderLeft: '1px solid var(--border)' }}>
          <div className="mb-2 flex flex-wrap gap-1">
            {RIGHT_TABS.map((t) => (
              <span key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.name}
              </span>
            ))}
          </div>
          <div className="h-[calc(100%-36px)]">
            {tab === 'lore' && <LorePanel />}
            {tab === 'outline' && <OutlinePanel />}
            {tab === 'summary' && <SummaryPanel />}
            {tab === 'style' && <StylePanel />}
            {tab === 'stats' && <StatsPanel />}
            {tab === 'search' && <SearchPanel />}
            {tab === 'history' && <HistoryPanel />}
          </div>
        </aside>
        )}
      </div>

      <StatusBar />

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  )
}
