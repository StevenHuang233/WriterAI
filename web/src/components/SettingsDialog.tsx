import { useStore } from '../store/useStore'

interface Props {
  onClose: () => void
}

export default function SettingsDialog({ onClose }: Props) {
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  const settingsInfo = useStore((s) => s.settingsInfo)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="panel w-[440px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[15px] font-semibold">设置</span>
          <button className="btn px-2 py-0.5" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span>提词等待时间</span>
            <span className="muted">{(prefs.idleMs / 1000).toFixed(1)} 秒</span>
          </div>
          <input
            type="range"
            min={2000}
            max={10000}
            step={500}
            value={prefs.idleMs}
            onChange={(e) => setPrefs({ idleMs: Number(e.target.value) })}
            className="w-full"
          />
          <div className="mt-1 text-[12px] muted">停止输入后等待多久给出提示。连续忽略提示会自动加长。</div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-[13px]">自动提词</span>
          <button className="btn" onClick={() => setPrefs({ paused: !prefs.paused })}>
            {prefs.paused ? '已暂停，点击开启' : '已开启，点击暂停'}
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-[13px]">主题</span>
          <button className="btn" onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}>
            {prefs.theme === 'dark' ? '深色（点击切换）' : '浅色（点击切换）'}
          </button>
        </div>

        <div className="rounded-md p-3 text-[12px]" style={{ background: 'var(--bg)' }}>
          <div className="mb-1 font-medium">模型（在项目根目录 .env 中配置，修改后重启服务）</div>
          <div className="flex items-center justify-between">
            <span>快速模型（实时提词）</span>
            <span className={settingsInfo?.fast.configured ? '' : ''} style={{ color: settingsInfo?.fast.configured ? 'var(--muted)' : '#dc2626' }}>
              {settingsInfo?.fast.model ?? '未配置'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>强模型（摘要 / 续写）</span>
            <span style={{ color: settingsInfo?.strong.configured ? 'var(--muted)' : '#dc2626' }}>
              {settingsInfo?.strong.model ?? '未配置'}
            </span>
          </div>
        </div>

        <div className="mt-4 text-[12px] muted">
          快捷键：Tab 接受全部 · Cmd/Ctrl+→ 接受到下一个标点 · Esc 忽略 · Cmd/Ctrl+J 手动提词 · Cmd/Ctrl+Shift+J 续写一段
        </div>
      </div>
    </div>
  )
}
