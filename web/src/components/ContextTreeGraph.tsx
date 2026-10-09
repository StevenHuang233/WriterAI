import { useMemo, useState } from 'react'
import type { ContextSettings, ContextTree, TreeNode } from '../api/client'

const STATE: Record<TreeNode['state'], { label: string; fill: string; text: string }> = {
  included: { label: '已纳入', fill: '#16a34a', text: '#fff' },
  locked: { label: '已锁定', fill: '#2563eb', text: '#fff' },
  over: { label: '预算挤掉', fill: '#d97706', text: '#fff' },
  pinned: { label: '已固定', fill: '#7c3aed', text: '#fff' },
  excluded: { label: '已排除', fill: '#dc2626', text: '#fff' },
  unused: { label: '未使用', fill: 'var(--bg)', text: 'var(--muted)' },
}

const LEAF_W = 104
const GAP = 10
const LEVEL_H = 76
const BAR_H = 30
const PAD = 14

interface Placed {
  node: TreeNode
  x: number
  w: number
  y: number
  h: number
}

/** 计算树形布局：叶子均分宽度，父节点横跨其子节点（冰柱图/树状图） */
function layout(tree: ContextTree) {
  const leafCount = tree.levels[0]?.nodes.length ?? 0
  const width = Math.max(360, leafCount * (LEAF_W + GAP) + PAD * 2)
  const maxLevel = tree.levels.length - 1
  const height = maxLevel * LEVEL_H + BAR_H + PAD * 2

  const placed = new Map<string, Placed>()
  const step = LEAF_W + GAP

  for (const node of tree.levels[0]?.nodes ?? []) {
    const i = node.startOrder - (tree.levels[0]!.nodes[0]?.startOrder ?? 0)
    placed.set(node.key, {
      node,
      x: PAD + i * step,
      w: LEAF_W,
      y: PAD + maxLevel * LEVEL_H,
      h: BAR_H,
    })
  }

  for (let level = 1; level <= maxLevel; level++) {
    for (const node of tree.levels[level]!.nodes) {
      const kids = node.children.map((k) => placed.get(k)).filter((p): p is Placed => Boolean(p))
      const x = kids.length > 0 ? Math.min(...kids.map((k) => k.x)) : PAD
      const right = kids.length > 0 ? Math.max(...kids.map((k) => k.x + k.w)) : PAD + LEAF_W
      placed.set(node.key, {
        node,
        x,
        w: Math.max(LEAF_W, right - x),
        y: PAD + (maxLevel - level) * LEVEL_H,
        h: BAR_H,
      })
    }
  }

  return { placed, width, height, step }
}

interface Props {
  tree: ContextTree
  settings: ContextSettings
  busy: boolean
  onPatch: (patch: Partial<ContextSettings>) => void
}

export default function ContextTreeGraph({ tree, settings, busy, onPatch }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  const { placed, width, height } = useMemo(() => layout(tree), [tree])
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
      const px = p.x + p.w / 2
      const py = p.y + p.h
      const cx = c.x + c.w / 2
      const cy = c.y
      const mid = py + (cy - py) / 2
      edges.push(
        <path
          key={`${p.node.key}->${key}`}
          d={`M ${px} ${py} V ${mid} H ${cx} V ${cy}`}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />,
      )
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="muted text-[12px]">
        最下面是每章的摘要，往上依次是 3 / 6 / 12 章一段的压缩。颜色是这次提词实际用到的部分；点节点可手动调整。
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
        <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setZoom(Math.max(0.5, +(zoom - 0.15).toFixed(2)))}>
          缩小
        </button>
        <span className="muted">{Math.round(zoom * 100)}%</span>
        <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setZoom(Math.min(2, +(zoom + 0.15).toFixed(2)))}>
          放大
        </button>
        <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setZoom(1)}>
          重置
        </button>
      </div>

      <div className="rounded-md p-2 text-[12px]" style={{ background: 'var(--bg)' }}>
        前情占用 {tree.usedChars} / {tree.budget} 字 · 共 {tree.totalChapters} 章 · 每 {tree.groupSize} 章一段
      </div>

      <div className="overflow-auto rounded-md" style={{ border: '1px solid var(--border)', maxHeight: 420 }}>
        <svg width={width * zoom} height={height * zoom} style={{ display: 'block' }}>
          <g transform={`scale(${zoom})`}>
            {edges}
            {[...placed.values()].map((p) => {
              const st = STATE[p.node.state]
              const isSel = selected === p.node.key
              const showChars = p.w >= 96
              return (
                <g key={p.node.key} onClick={() => setSelected(p.node.key)} style={{ cursor: 'pointer' }}>
                  <title>{`${p.node.label}｜${st.label}｜${p.node.chars} 字${p.node.text ? `\n${p.node.text}` : ''}`}</title>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.w}
                    height={p.h}
                    rx={6}
                    fill={st.fill}
                    stroke={p.node.state === 'unused' ? 'var(--border)' : st.fill}
                    strokeWidth={isSel ? 2.5 : 1}
                    strokeDasharray={p.node.state === 'unused' ? '3 2' : undefined}
                  />
                  {isSel && (
                    <rect
                      x={p.x - 3}
                      y={p.y - 3}
                      width={p.w + 6}
                      height={p.h + 6}
                      rx={8}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={2}
                    />
                  )}
                  <text
                    x={p.x + p.w / 2}
                    y={p.y + p.h / 2 + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fill={st.text}
                    style={{ pointerEvents: 'none' }}
                  >
                    {showChars ? `${p.node.label} ${p.node.chars}字` : p.node.label}
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
            <div className="muted mb-2">（这一层暂无内容，需要先生成章节摘要）</div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <button
              className={`btn px-1.5 py-0 text-[11px] ${settings.lockedNodes.includes(sel.key) ? 'btn-primary' : ''}`}
              disabled={busy}
              onClick={() => toggleLock(sel.key)}
              title="强制用这一层的粒度进入上下文"
            >
              {settings.lockedNodes.includes(sel.key) ? '取消锁定' : '用此层'}
            </button>
            <button
              className="btn px-1.5 py-0 text-[11px]"
              disabled={busy}
              onClick={() => toggleExclude(sel.chapterIds)}
            >
              {sel.excluded ? '恢复' : '排除'}
            </button>
            {sel.level === 0 && (
              <button className="btn px-1.5 py-0 text-[11px]" disabled={busy} onClick={() => togglePin(sel.chapterIds)}>
                {sel.pinned ? '取消固定' : '固定'}
              </button>
            )}
            <span className="flex-1" />
            {sel.level > 0 && (
              <span className="muted">
                包含 {sel.children.length} 个{sel.level === 1 ? '章' : '子段'}
              </span>
            )}
            <button className="btn px-1.5 py-0 text-[11px]" onClick={() => setSelected(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
