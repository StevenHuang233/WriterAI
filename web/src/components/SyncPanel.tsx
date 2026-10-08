import { useEffect, useState } from 'react'
import {
  apiSyncConfig, apiSyncPull, apiSyncPush, apiSyncRemote, apiSyncSave, apiSyncTest,
  type SyncConfigResponse, type SyncProviderForm, type SyncProviderType, type SyncRemoteInfo,
} from '../api/client'

const PROVIDERS: { id: SyncProviderType; name: string; hint: string }[] = [
  { id: 'local', name: '本地文件夹', hint: '网盘同步目录（Dropbox / iCloud / OneDrive / 坚果云本地目录）或任意文件夹' },
  { id: 's3', name: 'S3 兼容', hint: 'AWS S3、Cloudflare R2、阿里云 OSS、腾讯云 COS、MinIO' },
  { id: 'webdav', name: 'WebDAV', hint: '坚果云、Nextcloud、ownCloud' },
  { id: 'gist', name: 'GitHub Gist', hint: '存为私有 Gist，天然带版本历史' },
]

function emptyForm(type: SyncProviderType): SyncProviderForm {
  if (type === 'local') return { type, dir: '' }
  if (type === 's3') return { type, endpoint: '', region: '', bucket: '', key: '', accessKeyId: '', secretAccessKey: '' }
  if (type === 'webdav') return { type, url: '', username: '', password: '' }
  return { type, token: '', gistId: '' }
}

export default function SyncPanel() {
  const [config, setConfig] = useState<SyncConfigResponse | null>(null)
  const [type, setType] = useState<SyncProviderType>('local')
  const [form, setForm] = useState<SyncProviderForm>(emptyForm('local'))
  const [autoSync, setAutoSync] = useState(false)
  const [minutes, setMinutes] = useState(10)
  const [remote, setRemote] = useState<SyncRemoteInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function load() {
    const c = await apiSyncConfig()
    setConfig(c)
    setAutoSync(c.autoSync)
    setMinutes(c.autoSyncMinutes)
    if (c.provider) {
      setType(c.provider.type)
      setForm({ ...emptyForm(c.provider.type), ...c.provider })
      try {
        setRemote(await apiSyncRemote())
      } catch {
        setRemote(null)
      }
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const set = (patch: Partial<SyncProviderForm>) => setForm((f) => ({ ...f, ...patch }))

  async function save(then?: () => void) {
    setBusy('save')
    setMessage(null)
    try {
      const c = await apiSyncSave({ provider: { ...form, type }, autoSync, autoSyncMinutes: minutes })
      setConfig(c)
      if (c.provider) setForm({ ...emptyForm(c.provider.type), ...c.provider })
      // 若带后续动作（如测试连接），由后续动作自己设置提示，避免覆盖
      if (then) await then()
      else setMessage({ kind: 'ok', text: '配置已保存' })
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    setBusy('test')
    setMessage(null)
    try {
      const r = await apiSyncTest({ provider: { ...form, type } })
      setMessage({ kind: r.ok ? 'ok' : 'err', text: r.message })
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function push() {
    setBusy('push')
    setMessage(null)
    try {
      const r = await apiSyncPush()
      setMessage({ kind: 'ok', text: `已备份 ${r.projects} 个项目（${(r.bytes / 1024).toFixed(1)} KB）` })
      setRemote(await apiSyncRemote())
      setConfig(await apiSyncConfig())
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function pull(mode: 'merge' | 'replace') {
    if (mode === 'replace' && !confirm('“以云端为准”会先清空本地全部数据再导入，确定继续？')) return
    setBusy('pull')
    setMessage(null)
    try {
      const r = await apiSyncPull(mode)
      setMessage({ kind: 'ok', text: `已恢复：${r.counts.projects} 个项目 / ${r.counts.chapters} 章 / ${r.counts.lore} 条设定` })
      localStorage.removeItem('writerai-last-project')
      window.location.reload()
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const field = (label: string, key: keyof SyncProviderForm, placeholder?: string, secret?: boolean) => (
    <div className="mb-2" key={String(key)}>
      <div className="mb-1 text-[12px] muted">{label}</div>
      <input
        className="input"
        type={secret ? 'password' : 'text'}
        value={(form[key] as string) ?? ''}
        placeholder={placeholder}
        onChange={(e) => set({ [key]: e.target.value } as Partial<SyncProviderForm>)}
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {PROVIDERS.map((p) => (
          <span key={p.id} className={`tab ${type === p.id ? 'active' : ''}`} onClick={() => { setType(p.id); setForm(emptyForm(p.id)) }}>
            {p.name}
          </span>
        ))}
      </div>
      <div className="muted text-[12px]">{PROVIDERS.find((p) => p.id === type)?.hint}</div>

      {type === 'local' && field('目录路径', 'dir', '/Users/me/Dropbox/WriterAI')}
      {type === 's3' && (
        <>
          {field('Endpoint', 'endpoint', 'https://s3.us-east-1.amazonaws.com 或 https://<account>.r2.cloudflarestorage.com')}
          {field('Region', 'region', 'us-east-1（R2 填 auto）')}
          {field('Bucket', 'bucket', 'my-bucket')}
          {field('对象路径（可选）', 'key', 'writerai-sync.json')}
          {field('Access Key ID', 'accessKeyId')}
          {field('Secret Access Key', 'secretAccessKey', undefined, true)}
        </>
      )}
      {type === 'webdav' && (
        <>
          {field('WebDAV 地址', 'url', 'https://dav.jianguoyun.com/dav/WriterAI/')}
          {field('用户名', 'username')}
          {field('密码 / 应用密码', 'password', undefined, true)}
        </>
      )}
      {type === 'gist' && (
        <>
          {field('GitHub Token（需 gist 权限）', 'token', undefined, true)}
          {field('Gist ID（留空则自动创建）', 'gistId')}
        </>
      )}

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[13px]">
          <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
          自动备份
        </label>
        <input
          className="input w-16 px-1 py-0.5"
          type="number"
          min={1}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value) || 10)}
        />
        <span className="text-[12px] muted">分钟（本地有改动时）</span>
        <span className="flex-1" />
        <button className="btn" onClick={() => void save()} disabled={busy !== null}>
          保存
        </button>
        <button className="btn" onClick={() => void save(test)} disabled={busy !== null}>
          保存并测试
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn btn-primary" onClick={() => void push()} disabled={busy !== null || !config?.provider}>
          {busy === 'push' ? '备份中…' : '立即备份到云端'}
        </button>
        <button
          className="btn"
          onClick={() => void pull('merge')}
          disabled={busy !== null || !config?.provider}
          title="按 id 覆盖，本地独有的项目会保留"
        >
          从云端恢复（合并）
        </button>
        <button
          className="btn btn-danger"
          onClick={() => void pull('replace')}
          disabled={busy !== null || !config?.provider}
          title="先清空本地，再以云端为准导入"
        >
          以云端为准（覆盖本地）
        </button>
      </div>

      <div className="rounded-md p-3 text-[12px]" style={{ background: 'var(--bg)' }}>
        <div>
          本地：{config ? `${config.local.projects} 个项目 / ${config.local.chapters} 章` : '…'}
        </div>
        <div>
          云端：
          {remote?.exists
            ? `${remote.savedAt ? new Date(remote.savedAt).toLocaleString() : '未知时间'} · ${remote.projects?.length ?? 0} 个项目`
            : config?.provider
              ? '暂无备份'
              : '未配置'}
        </div>
        <div className="muted mt-1">
          最近备份：{config?.lastPushAt ? new Date(config.lastPushAt).toLocaleString() : '从未'}
        </div>
      </div>

      {message && (
        <div className="text-[12px]" style={{ color: message.kind === 'ok' ? 'var(--accent)' : '#dc2626' }}>
          {message.text}
        </div>
      )}
    </div>
  )
}
