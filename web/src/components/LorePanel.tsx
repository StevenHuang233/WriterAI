import { useState } from 'react'
import { useStore } from '../store/useStore'
import { LORE_TYPE_LABELS, type LoreType } from '../types'

const TYPE_KEYS = Object.keys(LORE_TYPE_LABELS) as LoreType[]

export default function LorePanel() {
  const lore = useStore((s) => s.detail?.lore)
  const createLore = useStore((s) => s.createLore)
  const updateLore = useStore((s) => s.updateLore)
  const deleteLore = useStore((s) => s.deleteLore)
  const [filter, setFilter] = useState<LoreType | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const list = (lore ?? []).filter((l) => filter === 'all' || l.type === filter)
  const entries = lore ?? []
  const selected = entries.find((l) => l.id === selectedId) ?? null

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    const type: LoreType = filter === 'all' ? 'character' : filter
    await createLore({ type, name })
    setNewName('')
  }

  /** 字段级 debounce 保存 */
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function patch(id: string, payload: Parameters<typeof updateLore>[1]) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void updateLore(id, payload)
    }, 600)
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <span className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          全部 {entries.length}
        </span>
        {TYPE_KEYS.map((t) => (
          <span key={t} className={`tab ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>
            {LORE_TYPE_LABELS[t]} {entries.filter((l) => l.type === t).length}
          </span>
        ))}
      </div>

      <div className="flex gap-1">
        <input
          className="input"
          placeholder={`新建${filter === 'all' ? '人物' : LORE_TYPE_LABELS[filter]}名称`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
        />
        <button className="btn btn-primary shrink-0" onClick={() => void handleCreate()} disabled={!newName.trim()}>
          新建
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1">
          {list.map((l) => (
            <div
              key={l.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]"
              style={{
                background: l.id === selectedId ? 'var(--bg)' : 'transparent',
                opacity: l.enabled ? 1 : 0.5,
              }}
              onClick={() => setSelectedId(l.id)}
            >
              <span className="tag shrink-0">{LORE_TYPE_LABELS[l.type]}</span>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {l.always_on && <span className="tag shrink-0" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>常驻</span>}
            </div>
          ))}
          {list.length === 0 && <div className="muted p-2 text-[12px]">暂无设定，建议至少添加主要人物</div>}
        </div>
      </div>

      {selected && (
        <div className="panel max-h-[46%] shrink-0 overflow-y-auto p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              className="input flex-1"
              value={selected.name}
              onChange={(e) => {
                patch(selected.id, { name: e.target.value })
                // 本地乐观更新由 store 的 updateLore 完成，此处仅防抖提交
              }}
            />
            <button
              className="btn btn-danger shrink-0"
              onClick={() => {
                if (confirm(`删除设定「${selected.name}」？`)) {
                  void deleteLore(selected.id)
                  setSelectedId(null)
                }
              }}
            >
              删除
            </button>
          </div>
          <div className="mb-2 flex items-center gap-3 text-[12px]">
            <select
              className="select w-auto"
              value={selected.type}
              onChange={(e) => patch(selected.id, { type: e.target.value as LoreType })}
            >
              {TYPE_KEYS.map((t) => (
                <option key={t} value={t}>
                  {LORE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={selected.always_on}
                onChange={(e) => patch(selected.id, { always_on: e.target.checked })}
              />
              常驻上下文
            </label>
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) => patch(selected.id, { enabled: e.target.checked })}
              />
              启用
            </label>
            <label className="flex items-center gap-1">
              优先级
              <input
                className="input w-14 px-1 py-0.5"
                type="number"
                min={0}
                max={100}
                value={selected.priority}
                onChange={(e) => patch(selected.id, { priority: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <div className="mb-1 text-[12px] muted">别名（逗号分隔，用于触发匹配；单字不参与匹配）</div>
          <input
            className="input mb-2"
            value={selected.aliases.join(', ')}
            onChange={(e) =>
              patch(selected.id, {
                aliases: e.target.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
              })
            }
          />
          <div className="mb-1 text-[12px] muted">设定内容</div>
          <textarea
            className="textarea mb-2"
            rows={4}
            value={selected.content}
            onChange={(e) => patch(selected.id, { content: e.target.value })}
          />
          <div className="mb-1 text-[12px] muted">当前状态（AI 会在章节摘要后自动更新）</div>
          <textarea
            className="textarea"
            rows={2}
            value={selected.current_state}
            onChange={(e) => patch(selected.id, { current_state: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
