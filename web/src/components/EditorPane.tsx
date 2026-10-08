import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { GhostText, ghostPluginKey } from '../editor/ghost-text'
import { IdleTrigger } from '../editor/idle-trigger'
import { cleanSuggestion, finalizeSuggestion } from '../editor/postprocess'
import { docToText, textToDoc } from '../editor/text'
import { apiFeedback, apiMaybeSummarize, streamSuggest } from '../api/client'
import { draftKey, useStore } from '../store/useStore'
import { SUGGEST_LENGTH_LABELS, type SuggestMode } from '../types'

interface DraftInfo {
  content: string
  at: number
}

export default function EditorPane() {
  const chapter = useStore((s) => s.activeChapter)
  const projectId = useStore((s) => s.detail?.project.id ?? null)
  const fastConfigured = useStore((s) => s.settingsInfo?.fast.configured ?? false)
  const strongConfigured = useStore((s) => s.settingsInfo?.strong.configured ?? false)
  const prefs = useStore((s) => s.prefs)
  const triggerState = useStore((s) => s.triggerState)
  const requesting = triggerState === 'requesting'

  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null)
  const triggerRef = useRef<IdleTrigger | null>(null)
  const runRef = useRef<(mode: SuggestMode, manual: boolean) => void>(() => {})
  const runSuggestRef = useRef<(signal: AbortSignal) => void>(() => {})
  const manualModeRef = useRef<'inline' | 'continue' | null>(null)
  const altRef = useRef(false)
  const runAltRef = useRef<() => void>(() => {})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentTextRef = useRef<string>('')
  const loadedContentRef = useRef<string>('')
  const lastSuggestRef = useRef<{ latencyMs: number } | null>(null)
  const busyRef = useRef(false)
  const statsThrottleRef = useRef<number>(0)
  const [draftInfo, setDraftInfo] = useState<DraftInfo | null>(null)

  // ---------- 触发器生命周期 ----------
  useEffect(() => {
    const t = new IdleTrigger({
      idleMs: useStore.getState().prefs.idleMs,
      onFire: (signal) => {
        void runSuggestRef.current(signal)
      },
      onStateChange: (s) => useStore.getState().setUi({ triggerState: s }),
    })
    triggerRef.current = t
    if (useStore.getState().prefs.paused) t.pause()

    const onVisibility = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      if (document.hidden) trigger.pause()
      else if (!useStore.getState().prefs.paused) trigger.resume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      t.dispose()
      triggerRef.current = null
    }
  }, [])

  // 阈值 / 暂停状态同步
  useEffect(() => {
    const t = triggerRef.current
    if (t) t.opts.idleMs = prefs.idleMs
  }, [prefs.idleMs])

  useEffect(() => {
    const t = triggerRef.current
    if (!t) return
    if (prefs.paused) t.pause()
    else t.resume()
  }, [prefs.paused])

  // ---------- 提词请求 ----------
  const runSuggest = useCallback(
    async (mode: SuggestMode, manual: boolean, signal?: AbortSignal) => {
      const st = useStore.getState()
      const editor = editorRef.current
      const ch = st.activeChapter
      if (!editor || !ch || !st.detail) return
      // 手动触发（点按钮）时把焦点还给编辑器
      if (manual) editor.commands.focus()
      if (!manual) {
        if (!editor.isFocused) return
        if (document.visibilityState !== 'visible') return
        if (!editor.state.selection.empty) return
        if (editor.state.doc.textContent.length === 0) return
        // 上一个提词还没被覆盖掉（仍在显示）→ 不再提词，避免浪费调用
        if (ghostPluginKey.getState(editor.state)) return
        // 已有请求在进行中 → 跳过
        if (busyRef.current) return
      }
      // 手动触发时，上一个请求已由 trigger.manualFire() 取消
      if (!st.settingsInfo?.[mode === 'inline' ? 'fast' : 'strong'].configured) {
        st.setUi({ lastSuggestError: mode === 'inline' ? '快速模型未配置，请检查 .env' : '强模型未配置，请检查 .env' })
        return
      }

      const pos = editor.state.selection.from
      const prefix = editor.state.doc.textBetween(Math.max(0, pos - 3000), pos, '\n\n')
      const suffix = editor.state.doc.textBetween(pos, Math.min(editor.state.doc.content.size, pos + 500), '\n\n')
      const startedAt = Date.now()
      editor.commands.clearGhost()
      busyRef.current = true

      let acc = ''
      try {
        const alt = altRef.current
        altRef.current = false
        await streamSuggest(
          {
            projectId: st.detail.project.id,
            chapterId: ch.id,
            prefix,
            suffix,
            mode,
            length: st.prefs.suggestLength,
            alt,
          },
          {
            signal,
            onMeta: (meta) => st.setUi({ usedLoreNames: meta.usedLoreNames }),
            onDelta: (t) => {
              acc += t
              // 光标已移动则不再显示
              if (editor.state.selection.from !== pos || signal?.aborted) return
              const clean = cleanSuggestion(acc, prefix, suffix)
              if (clean) editor.commands.setGhost(pos, clean)
            },
          },
        )
        if (signal?.aborted) return
        const finalText =
          mode === 'inline' ? finalizeSuggestion(acc, prefix, suffix) : cleanSuggestion(acc, prefix, suffix)
        lastSuggestRef.current = { latencyMs: Date.now() - startedAt }
        if (finalText) {
          if (editor.state.selection.from === pos) editor.commands.setGhost(pos, finalText)
          triggerRef.current?.requestShown()
          st.setUi({ lastLatencyMs: Date.now() - startedAt, lastSuggestError: null })
        } else {
          triggerRef.current?.requestSettled()
        }
      } catch (e) {
        if (signal?.aborted) return
        triggerRef.current?.requestSettled()
        useStore.getState().setUi({ lastSuggestError: e instanceof Error ? e.message : String(e) })
      } finally {
        busyRef.current = false
      }
    },
    [],
  )

  runRef.current = (mode, manual) => {
    if (!manual) return
    manualModeRef.current = mode
    triggerRef.current?.manualFire()
  }

  // “换一个”：用更高的随机度重新生成，得到不同的候选
  runAltRef.current = () => {
    altRef.current = true
    runRef.current('inline', true)
  }

  // onFire 绑定实际请求（手动触发时使用指定模式，自动触发为 inline）
  useEffect(() => {
    runSuggestRef.current = (signal) => {
      const manualMode = manualModeRef.current
      manualModeRef.current = null
      void runSuggest(manualMode ?? 'inline', manualMode !== null, signal)
    }
  }, [runSuggest])

  // ---------- 编辑器 ----------
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          horizontalRule: false,
          gapcursor: false,
        }),
        GhostText.configure({
          onAcceptAll: () => {
            triggerRef.current?.reportOutcome('accepted')
            triggerRef.current?.requestSettled()
            sendFeedback('accepted')
          },
          onAcceptPartial: () => {
            triggerRef.current?.reportOutcome('partial')
            triggerRef.current?.requestSettled()
            sendFeedback('partial')
          },
          onConsume: () => {
            triggerRef.current?.reportOutcome('partial')
            triggerRef.current?.requestSettled()
            sendFeedback('partial')
          },
          onDismiss: () => {
            const t = triggerRef.current
            if (t && t.currentState === 'showing') {
              t.reportOutcome('dismissed')
              t.requestSettled()
              sendFeedback('dismissed')
            }
          },
          onManualTrigger: () => runRef.current('inline', true),
          onAltSuggestion: () => runAltRef.current(),
          onManualContinue: () => runRef.current('continue', true),
        }),
      ],
      content: textToDoc(chapter?.content ?? ''),
      editorProps: {
        attributes: { class: 'novel-editor' },
        handleDOMEvents: {
          compositionstart: () => {
            triggerRef.current?.compositionStart()
            return false
          },
          compositionend: () => {
            triggerRef.current?.compositionEnd()
            return false
          },
        },
      },
      onUpdate: ({ editor: ed }) => {
        triggerRef.current?.notifyEdit()
        const text = docToText(ed)
        currentTextRef.current = text
        // 字数统计做节流：长文档下不必每次按键都刷新状态栏
        const now = Date.now()
        if (now - (statsThrottleRef.current ?? 0) > 300) {
          statsThrottleRef.current = now
          useStore.getState().setDraftChapterContent(text)
        }
        scheduleSave(text)
      },
      onSelectionUpdate: () => {
        triggerRef.current?.notifyActivity()
      },
      onFocus: () => {
        triggerRef.current?.setFocus(true)
      },
      onBlur: () => {
        triggerRef.current?.setFocus(false)
      },
    },
    // 章节切换由父组件的 key 重挂载处理，编辑器只创建一次
    [],
  )

  editorRef.current = editor

  function sendFeedback(outcome: 'accepted' | 'partial' | 'dismissed') {
    const st = useStore.getState()
    const ch = st.activeChapter
    const pid = st.detail?.project.id
    if (!ch || !pid) return
    void apiFeedback({
      projectId: pid,
      chapterId: ch.id,
      outcome,
      latencyMs: lastSuggestRef.current?.latencyMs,
    }).catch(() => {})
  }

  // ---------- 保存 ----------
  /** 按文档长度自适应保存间隔：长章节避免每秒全量上传 */
  function saveDelay(len: number): number {
    if (len < 5000) return 1000
    if (len < 20000) return 2000
    if (len < 50000) return 3000
    return 5000
  }

  function scheduleSave(text: string) {
    const ch = useStore.getState().activeChapter
    if (!ch) return
    try {
      localStorage.setItem(draftKey(ch.id), JSON.stringify({ content: text, at: Date.now() }))
    } catch {
      // 存储满时忽略
    }
    useStore.getState().setUi({ saveState: 'dirty' })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void doSave()
    }, saveDelay(text.length))
  }

  async function doSave() {
    const st = useStore.getState()
    const ch = st.activeChapter
    if (!ch) return
    try {
      await st.saveChapterContent(ch.id, currentTextRef.current)
    } catch {
      // 保存失败保留草稿，状态栏提示
    }
  }

  // 搜索结果跳转：切到目标章节后选中并滚动到匹配处
  useEffect(() => {
    const target = useStore.getState().jumpTarget
    const editorInstance = editorRef.current
    if (!target || !editorInstance) return
    if (target.chapterId !== chapter?.id) return

    const text = docToText(editorInstance)
    let from = -1
    for (let i = 0; i <= target.occurrence; i++) {
      from = text.indexOf(target.query, from < 0 ? 0 : from + 1)
      if (from < 0) break
    }
    useStore.getState().setJumpTarget(null)
    if (from < 0) return
    editorInstance.commands.focus()
    editorInstance.commands.setTextSelection({ from: from + 1, to: from + 1 + target.query.length })
    const dom = editorInstance.view.domAtPos(from + 1)?.node
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center' })
  }, [chapter?.id])

  // 章节切换/卸载时：flush 保存 + 条件摘要
  useEffect(() => {
    if (!chapter) return
    loadedContentRef.current = chapter.content
    currentTextRef.current = chapter.content

    // 草稿恢复检测
    const raw = localStorage.getItem(draftKey(chapter.id))
    if (raw) {
      try {
        const draft = JSON.parse(raw) as DraftInfo
        if (draft.content && draft.content !== chapter.content) {
          setDraftInfo(draft)
        } else if (draft.content === chapter.content) {
          localStorage.removeItem(draftKey(chapter.id))
        }
      } catch {
        localStorage.removeItem(draftKey(chapter.id))
      }
    } else {
      setDraftInfo(null)
    }

    const chapterId = chapter.id
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const text = currentTextRef.current
      if (text !== loadedContentRef.current) {
        void useStore.getState().saveChapterContent(chapterId, text).catch(() => {})
        void apiMaybeSummarize(chapterId).catch(() => {})
      }
      setDraftInfo(null)
    }
  }, [chapter?.id])

  function restoreDraft() {
    const editorInstance = editorRef.current
    if (!editorInstance || !draftInfo) return
    editorInstance.commands.setContent(textToDoc(draftInfo.content))
    currentTextRef.current = draftInfo.content
    scheduleSave(draftInfo.content)
    setDraftInfo(null)
  }

  function discardDraft() {
    const ch = useStore.getState().activeChapter
    if (ch) localStorage.removeItem(draftKey(ch.id))
    setDraftInfo(null)
  }

  if (!chapter || !projectId || !editor) {
    return (
      <div className="flex h-full items-center justify-center muted">
        {useStore.getState().detail?.chapters.length === 0 ? '还没有章节，请在左侧新建' : '加载中…'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {draftInfo && (
        <div
          className="mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-[13px]"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn-text)' }}
        >
          <span>
            检测到未保存的草稿（{draftInfo.content.length} 字）
          </span>
          <button className="btn" onClick={restoreDraft}>
            恢复
          </button>
          <button className="btn" onClick={discardDraft}>
            丢弃
          </button>
        </div>
      )}
      {!fastConfigured && (
        <div className="mb-2 rounded-md px-3 py-2 text-[13px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-text)' }}>
          快速模型未配置：请复制 .env.example 为 .env 并填写 FAST_* 配置，然后重启服务。
        </div>
      )}
      <div className="mx-auto mb-2 flex max-w-[760px] flex-wrap items-center gap-2">
        <button
          className="btn"
          title="撤销（Cmd/Ctrl+Z）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.commands.undo()}
        >
          撤销
        </button>
        <button
          className="btn"
          title="重做（Cmd/Ctrl+Shift+Z）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.commands.redo()}
        >
          重做
        </button>
        <button
          className="btn"
          title="Cmd/Ctrl + J"
          disabled={requesting || !fastConfigured}
          // 不让按钮抢走编辑器焦点，否则 Tab / Cmd+→ 无法接受提示
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runRef.current('inline', true)}
        >
          {requesting ? '思考中…' : '立即提词'}
        </button>
        <button
          className="btn"
          title="换个不同的提示（Alt+]）"
          disabled={requesting || !fastConfigured}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runRef.current('inline', true)}
        >
          换一个
        </button>
        <button
          className="btn"
          title="Cmd/Ctrl + Shift + J（用强模型续写较长一段）"
          disabled={requesting || !strongConfigured}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runRef.current('continue', true)}
        >
          续写一段
        </button>
        <span className="muted text-[12px]">
          {prefs.paused ? '自动提词已暂停' : `停顿 ${(prefs.idleMs / 1000).toFixed(1)} 秒自动提词`}
        </span>
        <span className="flex-1" />
        <span className="muted text-[12px]">
          {SUGGEST_LENGTH_LABELS[prefs.suggestLength]}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 py-8">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
