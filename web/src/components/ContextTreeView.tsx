import { useEffect, useMemo, useState } from 'react'
import type { ContextSettings, ContextTree, TreeNode } from '../api/client'

const STATE_STYLE: Record<TreeNode['state'], { label: string; bg: string; fg: string }> = {
  included: { label: '已纳入', bg: '#16a34a', fg: '#fff' },
  locked: { label: '已锁定', bg: '#2563eb', fg: '#fff' },
  over: { label: '预算挤掉', bg: '#d97706', fg: '#fff' },
  pinned: { label: '已固定', bg: '#7c3aed', fg: '#fff' },
  excluded: { label: '已排除', bg: '#dc2626', fg: '#fff' },
  unused: { label: '未使用', bg: 'transparent', fg: 'var(--muted, #888)' },
}

interface Props {
  tree: ContextTree
  settings: ContextSettings
  busy: boolean
  onPatch: (patch: Partial<ContextSettings>) => void
}

export default function ContextTreeView({ tree, settings, busy, onPatch }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const byKey = useMemo(() => {
    const m = new Map<string, TreeNode>()
    for (const l of tree.levels) for (const n of l.nodes) m.set(n.key, n)
    return m
  }, [tree])

  const parentOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of tree.levels) {
      for (const n of l.nodes) for (const c of n.children) m.set(c, n.key)
    }
    return m
  }, [tree])

  // 默认展开：所有被用到的节点及其祖先（让用户一眼看到实际生效的层级）
  useEffect(() => {
    const next = new Set<string>()
    for (const l of tree.levels) {
      for (const n of l.nodes) {
        if (n.state === 'unused') continue
        let cur: string | undefined = n.key
        while (cur) {
          if (next.has(cur)) break
          next.add(cur)
          cur = parentOf.get(cur)
        }
      }
    }
    setExpanded(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, parentOf])

  const roots = tree.levels[tree.levels.length - 1]?.nodes ?? []

  const toggleLock = (key: string) => {
    const cur = new Set(settings.lockedNodes)
    if (cur.has(key)) cur.delete(key)
    else cur.add(key)
    onPatch({ lockedNodes: [...cur] })
  }

  const toggleExclude = (ids: string[]) => {
    const cur = new Set(settings.excludedChapters)
    const all = ids.every((i) => cur.has(i))
    const next = new Set(cur)
    for (const id of ids) {
      if (all) next.delete(id)
      else next.add(id)
    }
    onPatch({ excludedChapters: [...next] })
  }

  const togglePin = (ids: string[]) => {
    const cur = new Set(settings.pinnedChapters)
    const all = ids.every((i) => cur.has(i))
    const next = new Set(cur)
    for (const id of ids) {
      if (all) next.delete(id)
      else next.add(id)
    }
    onPatch({ pinnedChapters: [...next] })
  }

  const allKeys = useMemo(() => [...byKey.keys()], [byKey])

  function renderNode(node: TreeNode, depth: number): JSX.Element {
    const style = STATE_STYLE[node.state]
    const hasChildren = node.children.length > 0
    const open = expanded.has(node.key)
    return (
      <div key={node.key} style={{ marginLeft: depth === 0 ? 0 : 14 }}>
        <div
          className="mb-1 rounded-md px-2 py-1.5 text-[12px]"
          style={{
            border: `1px solid ${node.state === 'unused' ? 'var(--border)' : style.bg}`,
            opacity: node.state === 'unused' ? 0.62 : 1,
          }}
        >
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button
                className="btn px-1 py-0 text-[11px]"
                onClick={() => {
                  const next = new Set(expanded)
                  if (open) next.delete(node.key)
                  else next.add(node.key)
                  setExpanded(next)
                }}
              >
                {open ? '▾' : '▸'}
              </button>
            ) : (
              <span style={{ width: 18 }} />
            )}
            <span className="min-w-0 flex-1 truncate">
              {node.label}
              <span className="muted ml-1">{node.span} 章</span>
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[11px]"
              style={{ background: style.bg, color: style.fg, border: node.state === 'unused' ? '1px solid var(--border)' : undefined }}
            >
              {style.label}
            </span>
            <span className="muted">{node.chars} 字</span>
          </div>

          {node.text && (
            <div className="muted mt-1 line-clamp-2" style={{ paddingLeft: 24 }}>
              {node.text}
              {node.source === 'llm' && <span className="ml-1">（模型压缩）</span>}
            </div>
          )}

          <div className="mt-1 flex items-center gap-1" style={{ paddingLeft: 24 }}>
            <button
              className={`btn px-1.5 py-0 text-[11px] ${settings.lockedNodes.includes(node.key) ? 'btn-primary' : ''}`}
              disabled={busy}
              onClick={() => toggleLock(node.key)}
              title="锁定：强制用这一层的粒度进入上下文"
            >
              {settings.lockedNodes.includes(node.key) ? '取消锁定' : '用此层'}
            </button>
            <button
              className="btn px-1.5 py-0 text-[11px]"
              disabled={busy}
              onClick={() => toggleExclude(node.chapterIds)}
              title="排除/恢复这一批章节"
            >
              {node.excluded ? '恢复' : '排除'}
            </button>
            {node.level === 0 && (
              <button
                className="btn px-1.5 py-0 text-[11px]"
                disabled={busy}
                onClick={() => togglePin(node.chapterIds)}
                title="固定：始终以完整摘要进入"
              >
                {node.pinned ? '取消固定' : '固定'}
              </button>
            )}
            <span className="flex-1" />
            <span className="muted">距离 {node.distance} 章 · 上限 {node.maxChars} 字</span>
          </div>
        </div>

        {hasChildren && open && (
          <div style={{ borderLeft: '1px dashed var(--border)', marginLeft: 6 }}>
            {node.children.map((k) => {
              const child = byKey.get(k)
              return child ? renderNode(child, depth + 1) : null
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="muted text-[12px]">
        叶子是每章摘要，往上是各种粒度的多章压缩。颜色表示这次提词实际用到了哪些节点；点「用此层」可手动指定用哪个粒度。
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {(Object.keys(STATE_STYLE) as TreeNode['state'][]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                background: STATE_STYLE[s].bg,
                border: s === 'unused' ? '1px solid var(--border)' : undefined,
              }}
            />
            {STATE_STYLE[s].label}
          </span>
        ))}
        <span className="flex-1" />
        <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setExpanded(new Set(allKeys))}>
          展开全部
        </button>
        <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setExpanded(new Set())}>
          折叠全部
        </button>
      </div>

      <div className="rounded-md p-2 text-[12px]" style={{ background: 'var(--bg)' }}>
        前情占用 {tree.usedChars} / {tree.budget} 字 · 共 {tree.totalChapters} 章 · 每 {tree.groupSize} 章一段
      </div>

      {roots.length === 0 && <div className="muted text-[12px]">当前章之前没有其他章节</div>}
      {roots.map((n) => renderNode(n, 0))}
    </div>
  )
}
