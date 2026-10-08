import { useEffect, useState } from 'react'
import { apiStats, type StatsResult } from '../api/client'
import { useStore } from '../store/useStore'

export default function StatsPanel() {
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!projectId) return
    void apiStats(projectId, 14).then(setStats).catch(() => setStats(null))
  }, [projectId, refreshKey])

  if (!projectId) return null
  if (!stats) return <div className="muted text-[12px]">加载中…</div>

  const max = Math.max(1, ...stats.daily.map((d) => Math.abs(d.chars)))

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex gap-2">
        <div className="panel flex-1 p-3 text-center">
          <div className="text-[20px] font-semibold">{stats.today}</div>
          <div className="muted text-[12px]">今日字数</div>
        </div>
        <div className="panel flex-1 p-3 text-center">
          <div className="text-[20px] font-semibold">{stats.streak}</div>
          <div className="muted text-[12px]">连续写作天数</div>
        </div>
        <div className="panel flex-1 p-3 text-center">
          <div className="text-[20px] font-semibold">{stats.total}</div>
          <div className="muted text-[12px]">全书字数</div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] muted">近 14 天</span>
          <button className="btn px-2 py-0.5 text-[12px]" onClick={() => setRefreshKey((k) => k + 1)}>
            刷新
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {stats.daily.slice(-14).map((d) => (
            <div key={d.day} className="flex items-center gap-2 text-[11px]">
              <span className="muted w-14 shrink-0">{d.day.slice(5)}</span>
              <div className="h-3 flex-1 rounded" style={{ background: 'var(--bg)' }}>
                <div
                  className="h-3 rounded"
                  style={{
                    width: `${Math.max(2, (Math.abs(d.chars) / max) * 100)}%`,
                    background: d.chars > 0 ? 'var(--accent)' : d.chars < 0 ? '#dc2626' : 'transparent',
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right">{d.chars > 0 ? `+${d.chars}` : d.chars}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[12px] muted">各章字数</div>
        {stats.chapters.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="muted">{c.chars} 字</span>
          </div>
        ))}
      </div>
    </div>
  )
}
