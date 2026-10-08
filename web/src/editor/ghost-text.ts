import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReplaceStep } from '@tiptap/pm/transform'
import { plainTextToNodes } from './text'
import { splitAtPunctuation } from './postprocess'

export interface GhostData {
  pos: number
  text: string
}

export const ghostPluginKey = new PluginKey<GhostData | null>('writerai-ghost')

export interface GhostTextOptions {
  /** Tab 全部接受后（文本已插入） */
  onAcceptAll: (text: string) => void
  /** 部分接受后（已插入到下一个标点） */
  onAcceptPartial: (accepted: string) => void
  /** 用户输入的字符恰好与提示开头一致，被“吃掉” */
  onConsume: (consumed: string) => void
  /** 提示被忽略（继续输入 / 点击移动光标 / Esc） */
  onDismiss: () => void
  /** Cmd/Ctrl+J 手动提词 */
  onManualTrigger: () => void
  /** Cmd/Ctrl+Shift+J 手动续写一段 */
  onManualContinue: () => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostText: {
      setGhost: (pos: number, text: string) => ReturnType
      clearGhost: () => ReturnType
    }
  }
}

function getGhost(editor: Editor): GhostData | null {
  return ghostPluginKey.getState(editor.state) ?? null
}

/**
 * 幽灵文本扩展：在光标处用 Decoration.widget 显示灰色提示。
 * 文本通过 textContent 设置，绝不使用 innerHTML。
 */
export const GhostText = Extension.create<GhostTextOptions, null>({
  name: 'ghostText',

  addOptions() {
    return {
      onAcceptAll: () => {},
      onAcceptPartial: () => {},
      onConsume: () => {},
      onDismiss: () => {},
      onManualTrigger: () => {},
      onManualContinue: () => {},
    }
  },

  addCommands() {
    return {
      setGhost:
        (pos: number, text: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(ghostPluginKey, { pos, text })
          return true
        },
      clearGhost:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(ghostPluginKey, null)
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    const editor = this.editor
    const opts = this.options

    return {
      Tab: () => {
        const ghost = getGhost(editor)
        if (!ghost) return false
        editor
          .chain()
          .focus()
          .insertContentAt(ghost.pos, plainTextToNodes(ghost.text))
          .command(({ tr }) => {
            tr.setMeta(ghostPluginKey, null)
            return true
          })
          .run()
        opts.onAcceptAll(ghost.text)
        return true
      },

      'Mod-ArrowRight': () => {
        const ghost = getGhost(editor)
        if (!ghost) return false
        const { accepted, rest } = splitAtPunctuation(ghost.text)
        editor
          .chain()
          .focus()
          .insertContentAt(ghost.pos, plainTextToNodes(accepted))
          .command(({ tr }) => {
            tr.setMeta(ghostPluginKey, rest ? { pos: ghost.pos + accepted.length, text: rest } : null)
            return true
          })
          .run()
        opts.onAcceptPartial(accepted)
        return true
      },

      Escape: () => {
        const ghost = getGhost(editor)
        if (!ghost) return false
        editor.chain().focus().command(({ tr }) => {
          tr.setMeta(ghostPluginKey, null)
          return true
        }).run()
        opts.onDismiss()
        return true
      },

      'Mod-j': () => {
        opts.onManualTrigger()
        return true
      },

      'Mod-Shift-j': () => {
        opts.onManualContinue()
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options

    return [
      new Plugin<GhostData | null>({
        key: ghostPluginKey,
        state: {
          init: () => null,
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(ghostPluginKey)
            if (meta !== undefined) return meta

            if (tr.docChanged && value) {
              const step = tr.steps[0]
              // 纯插入且与提示开头一致 → “吃掉”字符，保留剩余提示
              if (step instanceof ReplaceStep && step.from === value.pos && step.to === step.from) {
                const inserted = step.slice.content.firstChild?.textContent ?? ''
                if (inserted && value.text.startsWith(inserted)) {
                  const rest = value.text.slice(inserted.length)
                  if (rest) {
                    queueMicrotask(() => opts.onConsume(inserted))
                    return { pos: value.pos + inserted.length, text: rest }
                  }
                  queueMicrotask(() => opts.onConsume(inserted))
                  return null
                }
              }
              // 其他任何修改 → 忽略提示
              queueMicrotask(() => opts.onDismiss())
              return null
            }

            // 光标被移动（点击等）→ 忽略提示
            if (tr.selectionSet && value) {
              queueMicrotask(() => opts.onDismiss())
              return null
            }

            return value
          },
        },
        props: {
          decorations(state) {
            const ghost = ghostPluginKey.getState(state)
            if (!ghost || !ghost.text) return DecorationSet.empty
            if (ghost.pos < 0 || ghost.pos > state.doc.content.size) return DecorationSet.empty
            const widget = Decoration.widget(
              ghost.pos,
              () => {
                const span = document.createElement('span')
                span.className = 'ghost-text'
                span.textContent = ghost.text
                return span
              },
              { side: 1 },
            )
            return DecorationSet.create(state.doc, [widget])
          },
        },
      }),
    ]
  },
})
