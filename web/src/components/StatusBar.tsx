import { useStore } from '../store/useStore'

const TRIGGER_LABELS: Record<string, string> = {
  idle: '空闲',
  waiting: '等待输入停顿…',
  requesting: '正在思考…',
  showing: '提示中（Tab 接受 / Esc 忽略）',
  paused: '已暂停',
}

export default function StatusBar() {
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  const triggerState = useStore((s) => s.triggerState)
  const usedLoreNames = useStore((s) => s.usedLoreNames)
  const saveState = useStore((s) => s.saveState)
  const lastLatencyMs = useStore((s) => s.lastLatencyMs)
  const lastSuggestError = useStore((s) => s.lastSuggestError)
  const chapters = useStore((s) => s.detail?.chapters ?? [])
  const activeChapter = useStore((s) => s.activeChapter)
  const currentChars = useStore((s) => s.currentChapterChars)

  const totalChars =
    chapters.reduce((s, c) => s + c.content_length, 0) - (activeChapter?.content_length ?? 0) + currentChars

  return (
    <div
      className="flex items-center gap-4 px-3 py-1.5 text-[12px]"
      style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}
    >
      <button
        className="btn px-2 py-0.5"
        onClick={() => setPrefs({ paused: !prefs.paused })}
        title="暂停 / 恢复自动提词"
      >
        {prefs.paused ? '▶ 开启提词' : '⏸ 暂停提词'}
      </button>
      <span>{prefs.paused ? '自动提词已暂停' : TRIGGER_LABELS[triggerState] ?? triggerState}</span>
      {lastLatencyMs !== null && <span>上次 {lastLatencyMs}ms</span>}
      {usedLoreNames.length > 0 && (
        <span className="min-w-0 truncate">
          本次设定：{usedLoreNames.join('、')}
        </span>
      )}
      {lastSuggestError && <span style={{ color: '#dc2626' }}>{lastSuggestError}</span>}
      <span className="flex-1" />
      <span>
        本章 {currentChars} 字 · 全书 {totalChars} 字
      </span>
      <span>
        {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : '保存失败'}
      </span>
    </div>
  )
}
