import { useRef } from 'react'
import { useStore } from '../store/useStore'

export default function StylePanel() {
  const project = useStore((s) => s.detail?.project ?? null)
  const updateProject = useStore((s) => s.updateProject)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ synopsis?: string; style_note?: string }>({})

  if (!project) return null

  /** 合并待提交字段，避免连续编辑两个文本框时前一个被覆盖丢失 */
  function schedule(patch: { synopsis?: string; style_note?: string }) {
    pendingRef.current = { ...pendingRef.current, ...patch }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const data = pendingRef.current
      pendingRef.current = {}
      void updateProject(data)
    }, 800)
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="mb-1 text-[12px] muted">故事简介（放上下文最前面的常驻信息）</div>
        <textarea
          className="textarea"
          rows={4}
          defaultValue={project.synopsis}
          key={`synopsis-${project.id}`}
          onChange={(e) => schedule({ synopsis: e.target.value })}
        />
      </div>
      <div>
        <div className="mb-1 text-[12px] muted">风格指令（文风、视角、节奏等，靠近上下文末尾，影响更强）</div>
        <textarea
          className="textarea"
          rows={8}
          defaultValue={project.style_note}
          key={`style-${project.id}`}
          onChange={(e) => schedule({ style_note: e.target.value })}
          placeholder="例：第三人称有限视角，跟随主角林墨；文风冷峻克制，多用短句；战斗场面写具体动作，避免形容词堆砌。"
        />
      </div>
    </div>
  )
}
