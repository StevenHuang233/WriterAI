/**
 * 空闲触发器：与编辑器解耦的纯逻辑类（可用 vitest 假定时器测试）。
 *
 * - notifyActivity：光标移动/选区变化等，只重置计时，不改变文档版本
 * - notifyEdit：正文发生变化，文档版本 +1，重新进入待触发状态
 * - 每个文档版本只自动触发一次；manualFire 例外
 * - 连续 3 次被忽略则阈值 x1.5，6 次则 x2（上限 15s）；接受即恢复
 */
export type TriggerState = 'idle' | 'waiting' | 'requesting' | 'showing' | 'paused'

export interface IdleTriggerOptions {
  idleMs: number
  onFire: (signal: AbortSignal, version: number) => void
  onStateChange?: (state: TriggerState) => void
}

export class IdleTrigger {
  private version = 0
  private firedVersion = -1
  private mainTimer: ReturnType<typeof setTimeout> | null = null
  private composing = false
  private focused = true
  private pausedFlag = false
  private controller: AbortController | null = null
  private ignoreCount = 0
  private state: TriggerState = 'idle'
  private disposed = false

  constructor(public opts: IdleTriggerOptions) {}

  get currentVersion(): number {
    return this.version
  }

  get currentState(): TriggerState {
    return this.state
  }

  private setState(s: TriggerState): void {
    if (this.state !== s) {
      this.state = s
      this.opts.onStateChange?.(s)
    }
  }

  private idleDelay(): number {
    const mult = this.ignoreCount >= 6 ? 2 : this.ignoreCount >= 3 ? 1.5 : 1
    return Math.min(15000, Math.round(this.opts.idleMs * mult))
  }

  private arm(): void {
    this.clearTimer()
    if (this.disposed || this.pausedFlag || this.composing || !this.focused) return
    this.mainTimer = setTimeout(() => this.fire(), this.idleDelay())
    this.setState('waiting')
  }

  private clearTimer(): void {
    if (this.mainTimer !== null) {
      clearTimeout(this.mainTimer)
      this.mainTimer = null
    }
  }

  /** 光标移动、选区变化：重置计时，不改变版本 */
  notifyActivity(): void {
    this.arm()
  }

  /** 正文变化：版本 +1，中断进行中的请求，重新计时 */
  notifyEdit(): void {
    this.version++
    this.abortInflight()
    this.arm()
  }

  compositionStart(): void {
    this.composing = true
    this.clearTimer()
  }

  compositionEnd(): void {
    this.composing = false
    this.notifyEdit()
  }

  setFocus(focused: boolean): void {
    this.focused = focused
    if (!focused) {
      this.clearTimer()
      this.abortInflight()
    } else {
      this.arm()
    }
  }

  /** 选区状态由调用方在 onFire 时结合编辑器状态判断 */
  setHasSelection(_has: boolean): void {
    void _has
  }

  reportOutcome(outcome: 'accepted' | 'partial' | 'dismissed'): void {
    if (outcome === 'dismissed') this.ignoreCount++
    else this.ignoreCount = 0
  }

  manualFire(): void {
    if (this.disposed) return
    this.abortInflight()
    this.firedVersion = this.version
    this.controller = new AbortController()
    this.setState('requesting')
    this.opts.onFire(this.controller.signal, this.version)
  }

  pause(): void {
    this.pausedFlag = true
    this.clearTimer()
    this.abortInflight()
    this.setState('paused')
  }

  resume(): void {
    this.pausedFlag = false
    this.setState('idle')
    this.arm()
  }

  /** 请求完成并显示了幽灵文本 */
  requestShown(): void {
    this.setState('showing')
  }

  /** 幽灵文本消失，回到空闲 */
  requestSettled(): void {
    if (this.state !== 'paused') this.setState('idle')
  }

  private fire(): void {
    this.mainTimer = null
    if (this.disposed || this.pausedFlag || this.composing || !this.focused) return
    if (this.firedVersion === this.version) return
    this.firedVersion = this.version
    this.controller = new AbortController()
    this.setState('requesting')
    this.opts.onFire(this.controller.signal, this.version)
  }

  private abortInflight(): void {
    this.controller?.abort()
    this.controller = null
    if (this.state !== 'paused') this.setState('idle')
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.abortInflight()
  }
}
