import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AwsClient } from 'aws4fetch'

export interface ProviderResult {
  ok: boolean
  message: string
}

export interface CloudProvider {
  id: SyncProviderType
  label: string
  /** 上传快照文本 */
  put(text: string): Promise<void>
  /** 读取快照文本，不存在返回 null */
  get(): Promise<string | null>
  /** 把上一版内容另存为备份（.bak），避免一次坏备份覆盖好备份 */
  putBackup(text: string): Promise<void>
  /** 读取备份内容，不存在返回 null */
  getBackup(): Promise<string | null>
  test(): Promise<ProviderResult>
}

const BACKUP_SUFFIX = '.bak'

export type SyncProviderType = 'local' | 's3' | 'webdav' | 'gist'

export interface LocalConfig {
  type: 'local'
  /** 网盘同步目录或任意本地文件夹 */
  dir: string
}

export interface S3Config {
  type: 's3'
  endpoint: string
  region: string
  bucket: string
  key: string
  accessKeyId: string
  secretAccessKey: string
}

export interface WebdavConfig {
  type: 'webdav'
  url: string
  username: string
  password: string
}

export interface GistConfig {
  type: 'gist'
  token: string
  /** 为空时首次上传会自动创建 */
  gistId: string
}

export type SyncProviderConfig = LocalConfig | S3Config | WebdavConfig | GistConfig

const FILE_NAME = 'writerai-sync.json'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------- 本地文件夹 / 网盘同步目录 ----------------

class LocalProvider implements CloudProvider {
  id = 'local' as const
  label = '本地文件夹'
  private file: string

  constructor(private cfg: LocalConfig) {
    this.file = path.join(cfg.dir, FILE_NAME)
  }

  async put(text: string): Promise<void> {
    if (!this.cfg.dir) throw new Error('未配置目录')
    mkdirSync(this.cfg.dir, { recursive: true })
    writeFileSync(this.file, text, 'utf8')
  }

  async get(): Promise<string | null> {
    if (!existsSync(this.file)) return null
    return readFileSync(this.file, 'utf8')
  }

  async putBackup(text: string): Promise<void> {
    mkdirSync(this.cfg.dir, { recursive: true })
    writeFileSync(this.file + BACKUP_SUFFIX, text, 'utf8')
  }

  async getBackup(): Promise<string | null> {
    const f = this.file + BACKUP_SUFFIX
    if (!existsSync(f)) return null
    return readFileSync(f, 'utf8')
  }

  async test(): Promise<ProviderResult> {
    try {
      if (!this.cfg.dir) return { ok: false, message: '请先填写目录路径' }
      mkdirSync(this.cfg.dir, { recursive: true })
      writeFileSync(path.join(this.cfg.dir, '.writerai-test'), 'ok', 'utf8')
      return { ok: true, message: `可读写：${this.cfg.dir}` }
    } catch (e) {
      return { ok: false, message: errText(e) }
    }
  }
}

// ---------------- S3 兼容（AWS S3 / R2 / OSS / COS / MinIO） ----------------

class S3Provider implements CloudProvider {
  id = 's3' as const
  label = 'S3 兼容'

  constructor(private cfg: S3Config) {}

  private client(): AwsClient {
    return new AwsClient({
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      region: this.cfg.region || 'auto',
      service: 's3',
    })
  }

  private url(bak = false): string {
    const base = this.cfg.endpoint.replace(/\/+$/, '')
    const key = this.cfg.key.replace(/^\/+/, '') || FILE_NAME
    return `${base}/${this.cfg.bucket}/${key}${bak ? BACKUP_SUFFIX : ''}`
  }

  async put(text: string): Promise<void> {
    const res = await this.client().fetch(this.url(), {
      method: 'PUT',
      body: text,
      headers: { 'content-type': 'application/json' },
    })
    if (!res.ok) throw new Error(`上传失败 ${res.status} ${await res.text()}`)
  }

  async get(): Promise<string | null> {
    const res = await this.client().fetch(this.url(), { method: 'GET' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`下载失败 ${res.status} ${await res.text()}`)
    return res.text()
  }

  async putBackup(text: string): Promise<void> {
    const res = await this.client().fetch(this.url(true), {
      method: 'PUT',
      body: text,
      headers: { 'content-type': 'application/json' },
    })
    if (!res.ok) throw new Error(`备份失败 ${res.status} ${await res.text()}`)
  }

  async getBackup(): Promise<string | null> {
    const res = await this.client().fetch(this.url(true), { method: 'GET' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取备份失败 ${res.status} ${await res.text()}`)
    return res.text()
  }

  async test(): Promise<ProviderResult> {
    try {
      if (!this.cfg.endpoint || !this.cfg.bucket) return { ok: false, message: '请填写 Endpoint 与 Bucket' }
      const res = await this.client().fetch(this.url(), { method: 'HEAD' })
      if (res.ok || res.status === 404) return { ok: true, message: `存储可访问（${this.cfg.bucket}）` }
      return { ok: false, message: `无法访问：${res.status} ${await res.text()}` }
    } catch (e) {
      return { ok: false, message: errText(e) }
    }
  }
}

// ---------------- WebDAV（坚果云 / Nextcloud / ownCloud） ----------------

class WebdavProvider implements CloudProvider {
  id = 'webdav' as const
  label = 'WebDAV'

  constructor(private cfg: WebdavConfig) {}

  private url(bak = false): string {
    const base = this.cfg.url.replace(/\/+$/, '')
    const file = FILE_NAME + (bak ? BACKUP_SUFFIX : '')
    if (base.endsWith(file)) return base
    if (base.endsWith(FILE_NAME)) return base + (bak ? BACKUP_SUFFIX : '')
    return `${base}/${file}`
  }

  private auth(): string {
    return 'Basic ' + Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64')
  }

  async put(text: string): Promise<void> {
    const res = await fetch(this.url(), {
      method: 'PUT',
      body: text,
      headers: { authorization: this.auth(), 'content-type': 'application/json' },
    })
    if (!res.ok) throw new Error(`上传失败 ${res.status} ${await res.text()}`)
  }

  async get(): Promise<string | null> {
    const res = await fetch(this.url(), { method: 'GET', headers: { authorization: this.auth() } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`下载失败 ${res.status} ${await res.text()}`)
    return res.text()
  }

  async putBackup(text: string): Promise<void> {
    const res = await fetch(this.url(true), {
      method: 'PUT',
      body: text,
      headers: { authorization: this.auth(), 'content-type': 'application/json' },
    })
    if (!res.ok) throw new Error(`备份失败 ${res.status} ${await res.text()}`)
  }

  async getBackup(): Promise<string | null> {
    const res = await fetch(this.url(true), { method: 'GET', headers: { authorization: this.auth() } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取备份失败 ${res.status} ${await res.text()}`)
    return res.text()
  }

  async test(): Promise<ProviderResult> {
    try {
      if (!this.cfg.url) return { ok: false, message: '请填写 WebDAV 地址' }
      const res = await fetch(this.url(), { method: 'HEAD', headers: { authorization: this.auth() } })
      if (res.ok || res.status === 404 || res.status === 405) {
        return { ok: true, message: res.status === 404 ? '可连接（尚无备份文件）' : '已连接' }
      }
      return { ok: false, message: `连接失败 ${res.status}` }
    } catch (e) {
      return { ok: false, message: errText(e) }
    }
  }
}

// ---------------- GitHub Gist ----------------

class GistProvider implements CloudProvider {
  id = 'gist' as const
  label = 'GitHub Gist'

  constructor(private cfg: GistConfig) {}

  private headers() {
    return {
      authorization: `Bearer ${this.cfg.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'WriterAI',
    }
  }

  async put(text: string): Promise<void> {
    const body = JSON.stringify({ files: { [FILE_NAME]: { content: text } } })
    if (this.cfg.gistId) {
      const res = await fetch(`https://api.github.com/gists/${this.cfg.gistId}`, {
        method: 'PATCH',
        headers: this.headers(),
        body,
      })
      if (!res.ok) throw new Error(`更新失败 ${res.status} ${await res.text()}`)
      return
    }
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ description: 'WriterAI 备份', public: false, files: { [FILE_NAME]: { content: text } } }),
    })
    if (!res.ok) throw new Error(`创建失败 ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { id?: string }
    if (data.id) this.cfg.gistId = data.id
  }

  async get(): Promise<string | null> {
    if (!this.cfg.gistId) return null
    const res = await fetch(`https://api.github.com/gists/${this.cfg.gistId}`, { headers: this.headers() })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取失败 ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { files?: Record<string, { content?: string } | undefined> }
    return data.files?.[FILE_NAME]?.content ?? null
  }

  async putBackup(text: string): Promise<void> {
    if (!this.cfg.gistId) return
    const res = await fetch(`https://api.github.com/gists/${this.cfg.gistId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ files: { [FILE_NAME + BACKUP_SUFFIX]: { content: text } } }),
    })
    if (!res.ok) throw new Error(`备份失败 ${res.status} ${await res.text()}`)
  }

  async getBackup(): Promise<string | null> {
    if (!this.cfg.gistId) return null
    const res = await fetch(`https://api.github.com/gists/${this.cfg.gistId}`, { headers: this.headers() })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取备份失败 ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { files?: Record<string, { content?: string } | undefined> }
    return data.files?.[FILE_NAME + BACKUP_SUFFIX]?.content ?? null
  }

  async test(): Promise<ProviderResult> {
    try {
      if (!this.cfg.token) return { ok: false, message: '请填写 GitHub Token' }
      const res = await fetch('https://api.github.com/user', { headers: this.headers() })
      if (!res.ok) return { ok: false, message: `Token 无效 ${res.status}` }
      const u = (await res.json()) as { login?: string }
      return { ok: true, message: `已登录：${u.login ?? 'github'}${this.cfg.gistId ? '（已绑定 Gist）' : ''}` }
    } catch (e) {
      return { ok: false, message: errText(e) }
    }
  }
}

export function createProvider(cfg: SyncProviderConfig): CloudProvider {
  switch (cfg.type) {
    case 'local':
      return new LocalProvider(cfg)
    case 's3':
      return new S3Provider(cfg)
    case 'webdav':
      return new WebdavProvider(cfg)
    case 'gist':
      return new GistProvider(cfg)
  }
}

export const PROVIDER_LABELS: Record<SyncProviderType, string> = {
  local: '本地文件夹 / 网盘同步目录（Dropbox、iCloud、OneDrive、坚果云本地目录等）',
  s3: 'S3 兼容（AWS S3、Cloudflare R2、阿里云 OSS、腾讯云 COS、MinIO）',
  webdav: 'WebDAV（坚果云、Nextcloud、ownCloud）',
  gist: 'GitHub Gist（私有）',
}
