export interface Block {
  key: string
  title?: string
  text: string
  /** 数字越小越先被裁剪 */
  trimOrder: number
  /** false 表示不可裁剪 */
  flex: boolean
}

export function blockLength(b: Block): number {
  return (b.title ? b.title.length + 4 : 0) + b.text.length
}

export function renderBlocks(blocks: Block[]): string {
  return blocks
    .filter((b) => b.text.trim().length > 0)
    .map((b) => (b.title ? `【${b.title}】\n${b.text.trim()}` : b.text.trim()))
    .join('\n\n')
}

/** 在 budget 内裁剪 blocks：flex 块按 trimOrder 升序，先截半（保头部），再清空 */
export function fitBlocks(blocks: Block[], budget: number): Block[] {
  let total = blocks.reduce((s, b) => s + blockLength(b) + 2, 0)
  if (total <= budget) return blocks
  const result = blocks.map((b) => ({ ...b }))
  const flexBlocks = result.filter((b) => b.flex).sort((a, b) => a.trimOrder - b.trimOrder)

  // 第一轮：按 trimOrder 截半
  for (const b of flexBlocks) {
    if (total <= budget) break
    const before = blockLength(b) + 2
    b.text = cutTailKeepHead(b.text, Math.floor(b.text.length / 2))
    total += blockLength(b) + 2 - before
  }
  // 第二轮：按 trimOrder 清空
  for (const b of flexBlocks) {
    if (total <= budget) break
    const before = blockLength(b) + 2
    b.text = ''
    total += blockLength(b) + 2 - before
  }
  return result
}

/** 截断到不超过 target 长度，尽量在空白处断开 */
function cutTailKeepHead(text: string, target: number): string {
  if (target >= text.length) return text
  for (let i = target; i > 0 && i > target - 50; i--) {
    if (/\s/.test(text[i - 1] ?? '')) return text.slice(0, i)
  }
  return text.slice(0, target)
}
