import { describe, expect, it } from 'vitest'
import { parseSnapshot, SNAPSHOT_VERSION } from '../sync/snapshot.js'
import { maskState, mergeSecrets, MASK, type SyncState } from '../sync/config.js'
import type { S3Config, SyncProviderConfig } from '../sync/providers.js'

/** 构造合法快照的最小结构 */
function makeSnapshot() {
  const project = {
    id: 'p1',
    title: '测试',
    synopsis: '简介',
    global_summary: '梗概',
    style_note: '风格',
    created_at: 1,
    updated_at: 2,
  }
  return {
    version: SNAPSHOT_VERSION,
    savedAt: 1700000000000,
    projects: [
      {
        project,
        chapters: [
          {
            id: 'c1', project_id: 'p1', sort_order: 1, title: '第一章',
            content: '正文', summary: '摘要', summary_locked: 0,
            summarized_len: 2, created_at: 1, updated_at: 2,
          },
        ],
        lore: [
          {
            id: 'l1', project_id: 'p1', type: 'character', name: '林墨',
            aliases: ['小墨'], content: '设定', current_state: '状态',
            always_on: 1, priority: 0, enabled: 1, updated_at: 3,
          },
        ],
      },
    ],
  }
}

describe('parseSnapshot', () => {
  it('接受合法快照', () => {
    const snap = parseSnapshot(makeSnapshot())
    expect(snap.projects).toHaveLength(1)
    expect(snap.projects[0]!.chapters[0]!.title).toBe('第一章')
  })

  it('拒绝版本不符的快照', () => {
    expect(() => parseSnapshot({ ...makeSnapshot(), version: 99 })).toThrow()
  })

  it('拒绝结构损坏的快照（云端数据不可信）', () => {
    expect(() => parseSnapshot({ hello: 'world' })).toThrow()
    const bad = makeSnapshot()
    bad.projects[0]!.chapters[0]!.content = 123 as unknown as string
    expect(() => parseSnapshot(bad)).toThrow()
  })

  it('拒绝非法的 lore type', () => {
    const bad = makeSnapshot()
    bad.projects[0]!.lore[0]!.type = 'evil' as unknown as 'character'
    expect(() => parseSnapshot(bad)).toThrow()
  })
})

describe('密钥处理', () => {
  const s3: SyncProviderConfig = {
    type: 's3', endpoint: 'https://example.com', region: 'auto',
    bucket: 'b', key: 'k', accessKeyId: 'AKIA', secretAccessKey: 'SECRET',
  }

  it('返回前端前打码', () => {
    const state = { provider: s3, autoSync: false, autoSyncMinutes: 10, lastPushAt: null, lastPullAt: null, dirty: false } as SyncState
    const masked = maskState(state)
    const p = masked.provider as Record<string, unknown>
    expect(p.accessKeyId).toBe(MASK)
    expect(p.secretAccessKey).toBe(MASK)
    // bucket 等非敏感字段不打码
    expect(p.bucket).toBe('b')
  })

  it('前端回填打码值时不覆盖已保存的密钥', () => {
    const merged = mergeSecrets({ ...s3, accessKeyId: MASK, secretAccessKey: MASK }, s3) as S3Config
    expect(merged.accessKeyId).toBe('AKIA')
    expect(merged.secretAccessKey).toBe('SECRET')
  })

  it('用户填写的真实密钥会被采用', () => {
    const merged = mergeSecrets({ ...s3, secretAccessKey: 'NEW' }, s3) as S3Config
    expect(merged.secretAccessKey).toBe('NEW')
  })

  it('切换服务商类型时不继承旧密钥', () => {
    const merged = mergeSecrets({ type: 'webdav', url: 'https://dav/', username: 'u', password: 'p' }, s3)
    expect(merged).toEqual({ type: 'webdav', url: 'https://dav/', username: 'u', password: 'p' })
  })
})
