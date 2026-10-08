import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdleTrigger } from '../editor/idle-trigger'

function setup(idleMs = 4000) {
  const fires: Array<{ version: number; aborted: boolean }> = []
  const states: string[] = []
  const t = new IdleTrigger({
    idleMs,
    onFire: (signal, version) => fires.push({ version, aborted: signal.aborted }),
    onStateChange: (s) => states.push(s),
  })
  return { t, fires, states }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('IdleTrigger', () => {
  it('空闲达到阈值后触发一次', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    expect(fires).toHaveLength(0)
    vi.advanceTimersByTime(3999)
    expect(fires).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(fires).toHaveLength(1)
  })

  it('每次空闲只触发一次，不再重复', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    vi.advanceTimersByTime(60000)
    expect(fires).toHaveLength(1)
  })

  it('输入法组词期间不计时，组词结束重新计时', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    vi.advanceTimersByTime(3000)
    t.compositionStart()
    vi.advanceTimersByTime(60000)
    expect(fires).toHaveLength(0)
    t.compositionEnd() // 视为一次新的输入
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(1)
  })

  it('正文变化重新触发，纯光标移动只重置计时', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(1)
    // 光标移动：重置计时但不改变版本 → 不再触发
    t.notifyActivity()
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(1)
    // 正文变化：版本 +1 → 再次触发
    t.notifyEdit()
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(2)
  })

  it('退避：连续 3 次忽略后阈值变长', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(1)
    t.reportOutcome('dismissed')
    t.reportOutcome('dismissed')
    t.reportOutcome('dismissed')

    t.notifyEdit()
    vi.advanceTimersByTime(4000) // 原阈值已到，但退避后应为 6000
    expect(fires).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    expect(fires).toHaveLength(2)

    // 接受后退避恢复
    t.reportOutcome('accepted')
    t.notifyEdit()
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(3)
  })

  it('pause 后不触发，resume 恢复', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    t.pause()
    vi.advanceTimersByTime(60000)
    expect(fires).toHaveLength(0)
    t.resume()
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(1)
  })

  it('手动触发不受“一次空闲只触发一次”限制', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(1)
    t.manualFire()
    expect(fires).toHaveLength(2)
    t.manualFire()
    expect(fires).toHaveLength(3)
  })

  it('失焦时清除计时，聚焦后恢复', () => {
    const { t, fires } = setup(4000)
    t.notifyEdit()
    vi.advanceTimersByTime(2000)
    t.setFocus(false)
    vi.advanceTimersByTime(60000)
    expect(fires).toHaveLength(0)
    t.setFocus(true)
    vi.advanceTimersByTime(4000)
    expect(fires).toHaveLength(1)
  })
})
