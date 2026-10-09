import { useState } from 'react'
import { apiListModels, apiResetSettings, apiSaveSettings, apiSettings, apiTestSettings } from '../api/client'

type Kind = 'fast' | 'strong'

interface FormState {
  baseURL: string
  apiKey: string
  model: string
  effort: string
}

const PRESETS: { name: string; baseURL: string; model: string }[] = [
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'Ollama 本地', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
]

export default function ModelPanel() {
  const [form, setForm] = useState<Record<Kind, FormState>>({
    fast: { baseURL: '', apiKey: '', model: '', effort: '' },
    strong: { baseURL: '', apiKey: '', model: '', effort: '' },
  })
  const [loaded, setLoaded] = useState<Record<Kind, boolean>>({ fast: false, strong: false })
  const [models, setModels] = useState<Record<Kind, string[]>>({ fast: [], strong: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<Record<Kind, { ok: boolean; text: string } | null>>({ fast: null, strong: null })
  const [info, setInfo] = useState<Record<Kind, { configured: boolean; source: string; usingUI: boolean; model: string; baseURL: string } | null>>({
    fast: null,
    strong: null,
  })

  async function load(kind: Kind) {
    const s = await apiSettings()
    const cur = kind === 'fast' ? s.fast : s.strong
    setForm((f) => ({
      ...f,
      [kind]: {
        baseURL: cur.baseURL ?? '',
        apiKey: cur.apiKey ?? '',
        model: cur.model ?? '',
        effort: cur.effort ?? '',
      },
    }))
    setInfo((i) => ({
      ...i,
      [kind]: {
        configured: cur.configured,
        source: cur.source,
        usingUI: cur.usingUI,
        model: cur.model ?? '',
        baseURL: cur.baseURL ?? '',
      },
    }))
    setLoaded((l) => ({ ...l, [kind]: true }))
  }

  if (!loaded.fast && !loaded.strong) {
    void load('fast')
    void load('strong')
  }

  const set = (kind: Kind, patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, [kind]: { ...f[kind], ...patch } }))

  async function save(kind: Kind, then?: (kind: Kind) => Promise<void>) {
    setBusy(kind + '-save')
    setResult((r) => ({ ...r, [kind]: null }))
    try {
      const v = form[kind]
      await apiSaveSettings({
        [kind]: { baseURL: v.baseURL, apiKey: v.apiKey, model: v.model, effort: v.effort },
      })
      await then?.(kind)
      setResult((r) => ({ ...r, [kind]: { ok: true, text: '已保存并立即生效' } }))
      await load(kind)
    } catch (e) {
      setResult((r) => ({ ...r, [kind]: { ok: false, text: e instanceof Error ? e.message : String(e) } }))
    } finally {
      setBusy(null)
    }
  }

  async function test(kind: Kind) {
    setBusy(kind + '-test')
    setResult((r) => ({ ...r, [kind]: null }))
    try {
      const r = await apiTestSettings(kind)
      setResult((r2) => ({ ...r2, [kind]: { ok: r.ok, text: r.message } }))
    } finally {
      setBusy(null)
    }
  }

  async function fetchModels(kind: Kind) {
    setBusy(kind + '-list')
    try {
      const r = await apiListModels(kind)
      setModels((m) => ({ ...m, [kind]: r.models ?? [] }))
      setResult((r2) => ({ ...r2, [kind]: { ok: r.ok, text: r.message } }))
    } finally {
      setBusy(null)
    }
  }

  async function reset(kind: Kind) {
    setBusy(kind + '-reset')
    try {
      await apiResetSettings(kind)
      await load(kind)
      setResult((r) => ({ ...r, [kind]: { ok: true, text: '已恢复为 .env 中的配置' } }))
    } finally {
      setBusy(null)
    }
  }

  function card(kind: Kind, title: string, desc: string) {
    const v = form[kind]
    const meta = info[kind]
    return (
      <div key={kind} className="mb-3 rounded-md p-3" style={{ border: '1px solid var(--border)' }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[13px] font-medium">{title}</span>
          <span className="muted text-[12px]">
            {meta ? (meta.usingUI ? '界面配置' : '来自 .env') : ''}
            {meta?.configured ? ' · 已就绪' : ' · 未配置'}
          </span>
        </div>
        <div className="muted mb-2 text-[12px]">{desc}</div>

        <div className="mb-2 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <span
              key={p.name}
              className={`tab ${v.baseURL === p.baseURL ? 'active' : ''}`}
              onClick={() => set(kind, { baseURL: p.baseURL, model: v.model || p.model })}
            >
              {p.name}
            </span>
          ))}
        </div>

        <div className="mb-1 text-[12px] muted">Base URL</div>
        <input
          className="input mb-2"
          value={v.baseURL}
          placeholder="https://api.deepseek.com/v1"
          onChange={(e) => set(kind, { baseURL: e.target.value })}
        />

        <div className="mb-1 text-[12px] muted">API Key（本地服务可随意填）</div>
        <input
          className="input mb-2"
          type="password"
          value={v.apiKey}
          placeholder="sk-..."
          onChange={(e) => set(kind, { apiKey: e.target.value })}
        />

        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] muted">模型</span>
          <button className="btn px-2 py-0.5 text-[12px]" onClick={() => void fetchModels(kind)} disabled={busy !== null}>
            {busy === kind + '-list' ? '获取中…' : '获取可用模型'}
          </button>
        </div>
        {models[kind].length > 0 ? (
          <select
            className="select mb-2"
            value={models[kind].includes(v.model) ? v.model : ''}
            onChange={(e) => set(kind, { model: e.target.value })}
          >
            <option value="">选择模型</option>
            {models[kind].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : null}
        <input
          className="input mb-2"
          value={v.model}
          placeholder="模型名，如 deepseek-chat"
          onChange={(e) => set(kind, { model: e.target.value })}
        />

        <div className="mb-1 text-[12px] muted">思考力度（推理模型建议 low，非推理模型留空）</div>
        <select className="select mb-2" value={v.effort} onChange={(e) => set(kind, { effort: e.target.value })}>
          <option value="">默认</option>
          <option value="low">low（思考最少，最快）</option>
          <option value="high">high</option>
          <option value="max">max</option>
        </select>

        <div className="flex items-center gap-1">
          <button className="btn" onClick={() => void save(kind)} disabled={busy !== null}>
            {busy === kind + '-save' ? '保存中…' : '保存'}
          </button>
          <button className="btn" onClick={() => void save(kind, test)} disabled={busy !== null}>
            保存并测试
          </button>
          <button className="btn" onClick={() => void test(kind)} disabled={busy !== null}>
            {busy === kind + '-test' ? '测试中…' : '测试连接'}
          </button>
          <span className="flex-1" />
          <button className="btn" onClick={() => void reset(kind)} disabled={busy !== null}>
            用 .env
          </button>
        </div>

        {result[kind] && (
          <div className="mt-2 text-[12px]" style={{ color: result[kind]!.ok ? 'var(--accent)' : '#dc2626' }}>
            {result[kind]!.text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {card('fast', '快速模型', '用于实时提词，要求延迟低。')}
      {card('strong', '强模型', '用于章节摘要、全书梗概、人物状态、续写一段。')}
      <div className="muted text-[12px]">
        配置保存在 data/llm-config.json（仅本人可读），优先级高于 .env，保存后立即生效，无需重启。
      </div>
    </div>
  )
}
