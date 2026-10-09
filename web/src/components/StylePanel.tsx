import { useRef, useState } from 'react'
import { apiAnalyzeStyle, apiPatchProject, type StyleProfile } from '../api/client'
import { useStore } from '../store/useStore'

export default function StylePanel() {
  const project = useStore((s) => s.detail?.project ?? null)
  const updateProject = useStore((s) => s.updateProject)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ synopsis?: string; style_note?: string; style_profile?: string }>({})
  const [analyzing, setAnalyzing] = useState(false)
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  if (!project) return null
  const proj = project

  /** 合并待提交字段，避免连续编辑时前一个被覆盖丢失 */
  function schedule(patch: { synopsis?: string; style_note?: string; style_profile?: string }) {
    pendingRef.current = { ...pendingRef.current, ...patch }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const data = pendingRef.current
      pendingRef.current = {}
      void updateProject(data)
    }, 800)
  }

  async function analyze() {
    setAnalyzing(true)
    setMessage(null)
    try {
      const r = await apiAnalyzeStyle(proj.id)
      setProfile(r.profile)
      setMessage({ ok: true, text: `已根据最近 ${r.sampleChars} 字正文总结出文风，并已用于后续提词` })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAnalyzing(false)
    }
  }

  async function clearProfile() {
    await apiPatchProject(proj.id, { style_profile: '' })
    setProfile(null)
    setMessage({ ok: true, text: '已清除自动文风画像' })
    await useStore.getState().openProject(proj.id)
  }

  const fields: { key: keyof StyleProfile; label: string }[] = [
    { key: 'perspective', label: '视角' },
    { key: 'sentence', label: '句式' },
    { key: 'wording', label: '用词' },
    { key: 'dialogue', label: '对话' },
    { key: 'rhetoric', label: '意象' },
    { key: 'avoid', label: '避免' },
  ]

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] muted">文风画像（从你的正文自动总结）</span>
          <button className="btn px-2 py-0.5 text-[12px]" onClick={() => void analyze()} disabled={analyzing}>
            {analyzing ? '分析中…' : '从正文总结'}
          </button>
        </div>
        <div className="muted mb-1 text-[12px]">
          取样最近约 8000 字正文，总结出的风格会直接参与提词，让续写更像你自己的文风。
        </div>
        {project.style_profile ? (
          <>
            <textarea
              className="textarea"
              rows={5}
              defaultValue={project.style_profile}
              key={`profile-${project.id}-${project.style_profile.length}`}
              onChange={(e) => schedule({ style_profile: e.target.value })}
            />
            <div className="mt-1 flex items-center gap-2 text-[12px]">
              <span className="muted">
                {project.style_profile_at ? `生成于 ${new Date(project.style_profile_at).toLocaleString()}` : ''}
              </span>
              <span className="flex-1" />
              <button className="btn px-2 py-0.5" onClick={() => void clearProfile()}>
                清除
              </button>
            </div>
          </>
        ) : (
          <div className="muted text-[12px]">还没有文风画像，点上面的按钮生成（正文至少 300 字）</div>
        )}
      </div>

      {profile && (
        <div className="rounded-md p-2 text-[12px]" style={{ background: 'var(--bg)' }}>
          {fields.map((f) =>
            profile[f.key] ? (
              <div key={String(f.key)} className="mb-1">
                <span className="muted">{f.label}：</span>
                {profile[f.key]}
              </div>
            ) : null,
          )}
        </div>
      )}

      <div>
        <div className="mb-1 text-[12px] muted">故事简介（常驻上下文）</div>
        <textarea
          className="textarea"
          rows={4}
          defaultValue={project.synopsis}
          key={`synopsis-${project.id}`}
          onChange={(e) => schedule({ synopsis: e.target.value })}
        />
      </div>
      <div>
        <div className="mb-1 text-[12px] muted">手写风格指令（可选，写在画像之上，优先级更高）</div>
        <textarea
          className="textarea"
          rows={6}
          defaultValue={project.style_note}
          key={`style-${project.id}`}
          onChange={(e) => schedule({ style_note: e.target.value })}
          placeholder="例：第三人称有限视角；文风冷峻克制，多用短句；战斗写具体动作，避免形容词堆砌。"
        />
      </div>

      {message && (
        <div className="text-[12px]" style={{ color: message.ok ? 'var(--accent)' : '#dc2626' }}>
          {message.text}
        </div>
      )}
    </div>
  )
}
