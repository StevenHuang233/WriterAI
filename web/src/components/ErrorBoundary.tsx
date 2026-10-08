import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 渲染异常兜底：避免单个组件出错导致整页白屏、看起来像“卡死” */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[WriterAI] 渲染出错：', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="panel max-w-[520px] p-5">
          <div className="mb-2 font-semibold" style={{ color: '#dc2626' }}>
            界面出错了
          </div>
          <div className="muted mb-3 text-[13px] break-all">{this.state.error.message}</div>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            重试
          </button>
          <button className="btn ml-2" onClick={() => location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    )
  }
}
