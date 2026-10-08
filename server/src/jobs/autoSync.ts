import { createProvider } from '../sync/providers.js'
import { getSyncState, saveSyncState } from '../sync/config.js'
import { exportSnapshot } from '../sync/snapshot.js'

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/** 本地数据发生变化，标记为需要备份 */
export function markDirty(): void {
  saveSyncState({ dirty: true })
}

export function startAutoSync(): void {
  if (timer) return
  // 每分钟检查一次
  timer = setInterval(() => {
    void tick()
  }, 60_000)
}

export function stopAutoSync(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function tick(): Promise<void> {
  if (running) return
  const state = getSyncState()
  if (!state.autoSync || !state.provider || !state.dirty) return
  const due = state.lastPushAt === null || Date.now() - state.lastPushAt >= state.autoSyncMinutes * 60_000
  if (!due) return
  running = true
  try {
    const snap = exportSnapshot()
    const text = JSON.stringify(snap)
    await createProvider(state.provider).put(text)
    saveSyncState({ lastPushAt: Date.now(), dirty: false })
    console.log(`[sync] 已自动备份 ${snap.projects.length} 个项目`)
  } catch (e) {
    console.error('[sync] 自动备份失败:', e instanceof Error ? e.message : String(e))
  } finally {
    running = false
  }
}
