import type { Editor } from '@tiptap/react'

export interface TextBlock {
  type: 'paragraph'
  content: { type: 'text'; text: string }[]
}

/** 章节纯文本（\n 分段）→ ProseMirror 内容块 */
export function textToBlocks(text: string): TextBlock[] {
  return text.split('\n').map((t) => ({
    type: 'paragraph' as const,
    content: t ? [{ type: 'text' as const, text: t }] : [],
  }))
}

/** 编辑器文档 → 章节纯文本（\n 分段） */
export function docToText(editor: Editor): string {
  const blocks: string[] = []
  editor.state.doc.forEach((node) => {
    blocks.push(node.textContent)
  })
  return blocks.join('\n')
}

/** 纯文本（可含 \n）→ 插入用的内容节点数组 */
export function plainTextToNodes(text: string): Array<{ type: 'text'; text: string } | { type: 'paragraph' }> {
  const nodes: Array<{ type: 'text'; text: string } | { type: 'paragraph' }> = []
  const parts = text.split(/\n+/)
  parts.forEach((p, i) => {
    if (i > 0) nodes.push({ type: 'paragraph' })
    if (p) nodes.push({ type: 'text', text: p })
  })
  return nodes
}

/** 在指定位置插入纯文本（\n 拆为新段落） */
export function insertPlainText(editor: Editor, pos: number, text: string): void {
  editor.chain().focus().insertContentAt(pos, plainTextToNodes(text)).run()
}
