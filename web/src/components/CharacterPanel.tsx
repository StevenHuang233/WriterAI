import { useEffect, useRef, useState } from 'react'
import {
  apiAddStateHistory, apiAppearances, apiCharacters, apiCreateRelation, apiDeleteRelation,
  apiDetectCharacters, apiFillCharacter, apiInferRelations, apiPatchProfile, apiStateHistory,
  type AppearanceInfo, type CharacterItem, type CharacterProfile, type CharacterRelation,
  type StateHistoryItem,
} from '../api/client'
import { useStore } from '../store/useStore'

const AVATARS = ['🙂', '🗡️', '🌧️', '🍶', '🐉', '👤', '🧓', '👩', '🧙', '🥷']
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

const FIELDS: { key: keyof CharacterProfile; label: string; rows: number }[] = [
  { key: 'role', label: '身份 / 职业', rows: 1 },
  { key: 'appearance', label: '外貌', rows: 2 },
  { key: 'personality', label: '性格', rows: 2 },
  { key: 'motivation', label: '动机 / 目标', rows: 2 },
  { key: 'catchphrase', label: '口头禅 / 说话特点', rows: 1 },
]

export default function CharacterPanel() {
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const setActiveChapter = useStore((s) => s.setActiveChapter)
  const setJumpTarget = useStore((s) => s.setJumpTarget)
  const openProject = useStore((s) => s.openProject)

  const [items, setItems] = useState<CharacterItem[]>([])
  const [relations, setRelations] = useState<CharacterRelation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [appearances, setAppearances] = useState<AppearanceInfo | null>(null)
  const [history, setHistory] = useState<StateHistoryItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [relTarget, setRelTarget] = useState('')
  const [relLabel, setRelLabel] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Record<string, unknown>>({})

  async function load() {
    if (!projectId) return
    const r = await apiCharacters(projectId)
    setItems(r.characters)
    setRelations(r.relations)
    if (!selectedId && r.characters[0]) setSelectedId(r.characters[0].id)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!selectedId) return
    setAppearances(null)
    setHistory([])
    void apiAppearances(selectedId).then(setAppearances).catch(() => setAppearances(null))
    void apiStateHistory(selectedId).then(setHistory).catch(() => setHistory([]))
  }, [selectedId])

  const selected = items.find((i) => i.id === selectedId) ?? null
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? '?'

  /** 档案字段合并后防抖保存 */
  function patch(p: Record<string, string>) {
    if (!selectedId) return
    pendingRef.current = { ...pendingRef.current, ...p }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const data = pendingRef.current
      pendingRef.current = {}
      void apiPatchProfile(selectedId, data).then(() => void load())
    }, 700)
  }

  async function run(action: string, fn: () => Promise<{ text: string }>) {
    if (!projectId) return
    setBusy(action)
    setMessage(null)
    try {
      const r = await fn()
      await load()
      setMessage({ ok: true, text: r.text })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!projectId) return null

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          className="btn flex-1 justify-center"
          disabled={busy !== null}
          onClick={() =>
            void run('detect', async () => {
              const r = await apiDetectCharacters(projectId)
              return { text: r.created.length ? `识别出 ${r.created.length} 人：${r.created.join('、')}` : '没有新增人物（可能都已存在）' }
            })
          }
        >
          {busy === 'detect' ? '识别中…' : '从正文识别人物'}
        </button>
      </div>

      {items.length === 0 && (
        <div className="muted p-2 text-[12px]">还没有人物。可以手动在「设定」里新建（类型选人物），或点上面自动识别。</div>
      )}

      <div className="flex flex-wrap gap-1">
        {items.map((c) => (
          <span
            key={c.id}
            className={`tab ${selectedId === c.id ? 'active' : ''}`}
            onClick={() => setSelectedId(c.id)}
            style={c.profile?.color ? { color: c.profile.color } : undefined}
          >
            {c.profile?.avatar ? `${c.profile.avatar} ` : ''}
            {c.name}
          </span>
        ))}
      </div>

      {selected && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 flex items-center gap-2">
            <select
              className="select w-auto"
              value={selected.profile?.avatar ?? ''}
              onChange={(e) => patch({ avatar: e.target.value })}
            >
              <option value="">无头像</option>
              {AVATARS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              className="input flex-1"
              value={selected.name}
              onChange={(e) => {
                const v = e.target.value
                setItems((list) => list.map((i) => (i.id === selected.id ? { ...i, name: v } : i)))
                void apiPatchProfile(selected.id, {}) // 保底
                void (async () => {
                  const { apiPatchLore } = await import('../api/client')
                  await apiPatchLore(selected.id, { name: v })
                })()
              }}
            />
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className="h-4 w-4 rounded-full"
                  style={{ background: c, border: selected.profile?.color === c ? '2px solid var(--text)' : 'none' }}
                  onClick={() => patch({ color: c })}
                />
              ))}
            </div>
          </div>

          <div className="mb-2 flex gap-1">
            <input
              className="input w-20"
              placeholder="性别"
              value={selected.profile?.gender ?? ''}
              onChange={(e) => patch({ gender: e.target.value })}
            />
            <input
              className="input w-20"
              placeholder="年龄"
              value={selected.profile?.age ?? ''}
              onChange={(e) => patch({ age: e.target.value })}
            />
            <button
              className="btn flex-1 justify-center"
              disabled={busy !== null}
              onClick={() =>
                void run('fill', async () => {
                  const r = await apiFillCharacter(selected.id)
                  return { text: `已根据正文补全设定（参考 ${r.sampleChars} 字片段）` }
                })
              }
            >
              {busy === 'fill' ? '补全中…' : 'AI 补全设定'}
            </button>
          </div>

          {FIELDS.map((f) => (
            <div key={String(f.key)} className="mb-2">
              <div className="mb-1 text-[12px] muted">{f.label}</div>
              <textarea
                className="textarea"
                rows={f.rows}
                defaultValue={(selected.profile?.[f.key] as string) ?? ''}
                key={`${selected.id}-${String(f.key)}`}
                onChange={(e) => patch({ [f.key]: e.target.value })}
              />
            </div>
          ))}

          <div className="mb-2">
            <div className="mb-1 text-[12px] muted">当前状态（摘要后自动更新）</div>
            <textarea
              className="textarea"
              rows={2}
              defaultValue={selected.current_state}
              key={`state-${selected.id}`}
              onChange={(e) => {
                const v = e.target.value
                setItems((list) => list.map((i) => (i.id === selected.id ? { ...i, current_state: v } : i)))
                void (async () => {
                  const { apiPatchLore } = await import('../api/client')
                  await apiPatchLore(selected.id, { current_state: v })
                })()
              }}
            />
          </div>

          {/* 出场章节 */}
          <div className="mb-2">
            <div className="mb-1 text-[12px] muted">
              出场章节{appearances ? `（共 ${appearances.total} 次）` : ''}
            </div>
            {appearances?.chapters.length ? (
              <div className="flex flex-wrap gap-1">
                {appearances.chapters.map((a) => (
                  <button
                    key={a.chapterId}
                    className="btn px-2 py-0.5 text-[12px]"
                    onClick={() => {
                      setJumpTarget({ chapterId: a.chapterId, query: selected.name, occurrence: 0 })
                      void setActiveChapter(a.chapterId)
                    }}
                  >
                    {a.sortOrder}. {a.title}（{a.count}）
                  </button>
                ))}
              </div>
            ) : (
              <div className="muted text-[12px]">正文里还没有出现</div>
            )}
          </div>

          {/* 关系 */}
          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] muted">人物关系</span>
              <button
                className="btn px-2 py-0.5 text-[12px]"
                disabled={busy !== null}
                onClick={() =>
                  void run('infer', async () => {
                    const r = await apiInferRelations(selected.id)
                    return { text: r.added.length ? `新增关系：${r.added.join('；')}` : '没有推断出新的关系' }
                  })
                }
              >
                {busy === 'infer' ? '推断中…' : 'AI 推断关系'}
              </button>
            </div>
            {relations
              .filter((r) => r.a_lore_id === selected.id || r.b_lore_id === selected.id)
              .map((r) => (
                <div key={r.id} className="mb-1 flex items-center gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">
                    {nameOf(r.a_lore_id)} — {nameOf(r.b_lore_id)}：{r.label}
                  </span>
                  <button
                    className="btn px-1.5 py-0"
                    onClick={async () => {
                      await apiDeleteRelation(r.id)
                      void load()
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            <div className="mt-1 flex gap-1">
              <select className="select w-auto" value={relTarget} onChange={(e) => setRelTarget(e.target.value)}>
                <option value="">选择人物</option>
                {items.filter((i) => i.id !== selected.id).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <input
                className="input flex-1"
                placeholder="关系，如：师徒"
                value={relLabel}
                onChange={(e) => setRelLabel(e.target.value)}
              />
              <button
                className="btn"
                disabled={!relTarget || !relLabel.trim()}
                onClick={async () => {
                  await apiCreateRelation(projectId, selected.id, relTarget, relLabel.trim())
                  setRelLabel('')
                  void load()
                }}
              >
                添加
              </button>
            </div>
          </div>

          {/* 状态时间线 */}
          <div>
            <div className="mb-1 text-[12px] muted">状态时间线</div>
            {history.length === 0 && <div className="muted text-[12px]">还没有记录（章节摘要后会自动记录）</div>}
            {history.map((h) => (
              <div key={h.id} className="mb-1 rounded-md p-2 text-[12px]" style={{ border: '1px solid var(--border)' }}>
                <div className="muted mb-1">
                  {new Date(h.created_at).toLocaleString()}
                  {h.chapter_title ? ` · ${h.chapter_title}` : ''}
                </div>
                <div>{h.state}</div>
              </div>
            ))}
            {selected.current_state && (
              <button
                className="btn mt-1"
                onClick={async () => {
                  await apiAddStateHistory(selected.id, selected.current_state)
                  setHistory(await apiStateHistory(selected.id))
                }}
              >
                把当前状态记入时间线
              </button>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="text-[12px]" style={{ color: message.ok ? 'var(--accent)' : '#dc2626' }}>
          {message.text}
        </div>
      )}
    </div>
  )
}
