import { useMemo, useState } from 'react'
import type { ContextSettings, ContextTree, TreeNode } from '../api/client'

const STATE: Record<TreeNode['state'], { label: string; fill: string; text: string; edge: string }> = {
  included: { label: '已纳入', fill: '#16a34a', text: '#fff', edge: '#16a34a' },
  locked: { label: '已锁定', fill: '#2563eb', text: '#fff', edge: '#2563eb' },
  over: { label: '预算挤掉', fill: '#d97706', text: '#fff', edge: '#d97706' },
  pinned: { label: '已固定', fill: '#7c3aed', text: '#fff', edge: '#7c3aed' },
  excluded: { label: '已排除', fill: '#dc2626', text: '#fff', edge: '#dc2626' },
  unused: { label: '未使用', fill: 'var(--bg)', text: 'var(--muted)', edge: 'var(--border)' },
}

const NODE_W = 118
const NODE_H = 26
const COL_GAP = 58
const ROW_H = 30
const PAD = 12

interface Placed {
  node: TreeNode
  x: number
  y: number
  dim: boolean
}

/**
 * 横向思维导图：最右边一列是每章（叶子），多章合并时在左边长出父节点，
 * 父节点垂直居中于它包含的章节，用曲线连到每个子节点。
 */
export default function ContextMindMap({
  tree,
  settings,
  busy,
  onPatch,
}: {
  tree: ContextTree
  settings: ContextSettings
  busy: boolean
  onPatch: (patch: Partial<ContextSettings>) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [showUnused, setShowUnused] = useState(false)
  const [zoom, setZoom] = useState(1)

  const { placed, width, height, parentOf } = useMemo(() => {
    const maxLevel = tree.levels.length - 1
    const parentOf = new Map<string, string>()
    for (const l of tree.levels) {
      for (const n of l.nodes) for (const c of n.children) parentOf.set(c, n.key)
    }
    const byKey = new Map<string, TreeNode>()
    for (const l of tree.levels) for (const n of l.nodes) byKey.set(n.key, n)

    // 默认显示「被用到的节点 + 它们的祖先 + 它们的子孙」：
    // 祖先用来看出层级，子孙用来看出这一条合并了哪几章
    const keep = new Set<string>()
    for (const l of tree.levels) {
      for (const n of l.nodes) {
        if (n.state === 'unused') continue
        let cur: string | undefined = n.key
        while (cur && !keep.has(cur)) {
          keep.add(cur)
          cur = parentOf.get(cur)
        }
        const stack = [n.key]
        while (stack.length > 0) {
          const k = stack.pop()!
          if (keep.has(k) && k !== n.key) continue
          keep.add(k)
          const node = byKey.get(k)
          if (node) stack.push(...node.children)
        }
      }
    }

    const leaves = tree.levels[0]?.nodes ?? []
    const placed = new Map<string, Placed>()
    const colX = (level: number) => PAD + (maxLevel - level) * (NODE_W + COL_GAP)

    leaves.forEach((n, i) => {
      placed.set(n.key, { node: n, x: colX(0), y: PAD + i * ROW_H, dim: false })
    })
    for (let level = 1; level <= maxLevel; level++) {
      for (const n of tree.levels[level]!.nodes) {
        const kids = n.children.map((k) => placed.get(k)).filter((p): p is Placed => Boolean(p))
        const ys = kids.map((k) => k.y)
        const y = ys.length > 0 ? (Math.min(...ys) + Math.max(...ys)) / 2 : PAD
        placed.set(n.key, { node: n, x: colX(level), y, dim: false })
      }
    }

    const visible = new Map<string, Placed>()
    for (const [key, p] of placed) {
      const inUse = p.node.state !== 'unused'
      if (!showUnused && !keep.has(key)) continue
      visible.set(key, { ...p, dim: !inUse })
    }

    const xs = [...visible.values()].map((p) => p.x + NODE_W)
    const ys = [...visible.values()].map((p) => p.y + NODE_H)
    return {
      placed: visible,
      parentOf,
      width: Math.max(320, Math.max(...xs, 0) + PAD),
      height: Math.max(160, Math.max(...ys, 0) + PAD),
    }
  }, [tree, showUnused])

  const sel = selected ? placed.get(selected)?.node : undefined

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

  const edges: JSX.Element[] = []
  for (const p of placed.values()) {
    for (const key of p.node.children) {
      const c = placed.get(key)
      if (!c) continue
      const x1 = p.x + NODE_W
      const y1 = p.y + NODE_H / 2
      const x2 = c.x
      const y2 = c.y + NODE_H / 2
      const dx = Math.max(18, (x2 - x1) / 2)
      edges.push(
        <path
          key={`${p.node.key}->${key}`}
          d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
          fill="none"
          stroke={p.dim ? 'var(--border)' : STATE[p.node.state].edge}
          strokeWidth={p.dim ? 1 : 1.6}
          strokeDasharray={p.dim ? '3 3' : undefined}
          opacity={p.dim ? 0.7 : 1}
        />,
      )
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="muted text-[12px]">
        最右边是每一章，左边是合并出来的父节点——几个章节被合成一条时，它们上方就会长出父节点。点击节点可锁定用哪一层。
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {(Object.keys(STATE) as TreeNode['state'][]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                background: STATE[s].fill,
                border: s === 'unused' ? '1px solid var(--border)' : undefined,
              }}
            />
            {STATE[s].label}
          </span>
        ))}
        <span className="flex-1" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showUnused} onChange={(e) => setShowUnused(e.target.checked)} />
          显示全部层级
        </label>
        <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setZoom(Math.max(0.5, +(zoom - 0.15).toFixed(2)))}>
          缩小
        </button>
        <span className="muted">{Math.round(zoom * 100)}%</span>
        <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setZoom(Math.min(2, +(zoom + 0.15).toFixed(2)))}>
          放大
        </button>
      </div>

      <div className="rounded-md p-2 text-[12px]" style={{ background: 'var(--bg)' }}>
        前情占用 {tree.usedChars} / {tree.budget} 字 · 共 {tree.totalChapters} 章 · 每 {tree.groupSize} 章一段
      </div>

      <div className="overflow-auto rounded-md" style={{ border: '1px solid var(--border)', maxHeight: 460 }}>
        <svg width={width * zoom} height={height * zoom} style={{ display: 'block' }}>
          <g transform={`scale(${zoom})`}>
            {edges}
            {[...placed.values()].map((p) => {
              const st = STATE[p.node.state]
              const isSel = selected === p.node.key
              return (
                <g key={p.node.key} onClick={() => setSelected(p.node.key)} style={{ cursor: 'pointer' }}>
                  <title>{`${p.node.label}｜${st.label}｜${p.node.chars} 字${p.node.text ? `\n${p.node.text}` : ''}`}</title>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={5}
                    fill={st.fill}
                    stroke={p.node.state === 'unused' ? 'var(--border)' : st.fill}
                    strokeWidth={isSel ? 2.5 : 1}
                    strokeDasharray={p.node.state === 'unused' ? '3 2' : undefined}
                    opacity={p.dim ? 0.75 : 1}
                  />
                  {isSel && (
                    <rect
                      x={p.x - 3}
                      y={p.y - 3}
                      width={NODE_W + 6}
                      height={NODE_H + 6}
                      rx={7}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={2}
                    />
                  )}
                  <text
                    x={p.x + 8}
                    y={p.y + NODE_H / 2 + 4}
                    fontSize={11}
                    fill={st.text}
                    style={{ pointerEvents: 'none' }}
                  >
                    {p.node.label}
                  </text>
                  <text
                    x={p.x + NODE_W - 8}
                    y={p.y + NODE_H / 2 + 4}
                    fontSize={10}
                    textAnchor="end"
                    fill={st.text}
                    opacity={0.85}
                    style={{ pointerEvents: 'none' }}
                  >
                    {p.node.chars}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {sel && (
        <div className="rounded-md p-2 text-[12px]" style={{ border: '1px solid var(--accent)' }}>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">{sel.label}</span>
            <span className="tag">{STATE[sel.state].label}</span>
            <span className="muted">
              {sel.span} 章 · {sel.tier === 'full' ? '完整摘要' : sel.tier === 'brief' ? '一句话' : '极简'} · 上限 {sel.maxChars} 字
            </span>
            <span className="flex-1" />
            <span className="muted">距离 {sel.distance} 章</span>
          </div>
          {sel.text ? (
            <div className="muted mb-2 line-clamp-3">{sel.text}</div>
          ) : (
            <div className="muted mb-2">（这一层暂无内容）</div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <button
              className={`btn px-1.5 py-0 text-[11px] ${settings.lockedNodes.includes(sel.key) ? 'btn-primary' : ''}`}
              disabled={busy}
              onClick={() => toggleLock(sel.key)}
            >
              {settings.lockedNodes.includes(sel.key) ? '取消锁定' : '用此层'}
            </button>
            <button className="btn px-1.5 py-0 text-[11px]" disabled={busy} onClick={() => toggleExclude(sel.chapterIds)}>
              {sel.excluded ? '恢复' : '排除'}
            </button>
            {sel.level === 0 && (
              <button className="btn px-1.5 py-0 text-[11px]" disabled={busy} onClick={() => togglePin(sel.chapterIds)}>
                {sel.pinned ? '取消固定' : '固定'}
              </button>
            )}
            <span className="flex-1" />
            <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setSelected(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
