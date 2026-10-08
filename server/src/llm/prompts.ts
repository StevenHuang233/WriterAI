import type { ChatMessage } from './client.js'

/** 实时提词（fast 模型） */
export const SUGGEST_SYSTEM_INLINE = `你是一位小说写作助手，负责在作者停顿时给出接下来的一小段文字提示。
要求：
1. 只输出紧接在【正文】末尾之后的续写内容，不重复已有文字，不加任何解释、引号或标题。
2. 长度 15～60 个汉字，最多写到一句话或一个短句群结束。
3. 严格遵守设定与人物当前状态，不得与前情矛盾；不确定的信息不要编造新设定。
4. 保持与正文一致的人称、时态、文风。
5. 如果给出了【光标后文】，续写必须能自然衔接到它。`

/** 手动续写一段（strong 模型） */
export const SUGGEST_SYSTEM_CONTINUE = `你是一位小说写作助手，负责在作者要求时续写接下来的一段正文。
要求：
1. 只输出紧接在【正文】末尾之后的续写内容，不重复已有文字，不加任何解释、引号或标题。
2. 长度 200～500 个汉字，可以包含多个自然段。
3. 严格遵守设定与人物当前状态，不得与前情矛盾；不确定的信息不要编造新设定。
4. 保持与正文一致的人称、时态、文风。
5. 如果给出了【光标后文】，续写必须能自然衔接到它。`

export function suggestSystemPrompt(mode: 'inline' | 'continue'): string {
  return mode === 'inline' ? SUGGEST_SYSTEM_INLINE : SUGGEST_SYSTEM_CONTINUE
}

/** 章节摘要 */
export function chapterSummaryPrompt(text: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `请为以下小说章节写摘要，供后续写作时回顾前情使用。
要求：
1. 150～300 字，按时间顺序概括关键事件。
2. 必须保留：人物的重要决定、关系变化、受伤/获得/失去的物品、新出现的伏笔与未解决的悬念。
3. 不写评价，不写文学性描写。
只输出摘要正文。

${text}`,
    },
  ]
}

/** 全书梗概滚动合并 */
export function mergeGlobalSummaryPrompt(oldSummary: string, chapterTitle: string, chapterSummary: string): ChatMessage[] {
  const old = oldSummary.trim() || '（暂无，这是第一章）'
  return [
    {
      role: 'user',
      content: `下面是一部小说到目前为止的全书梗概，以及新完成的一章的摘要。请将新内容合并进梗概。
要求：总长度不超过 800 字；越早的情节越精简，最近的情节保留更多细节；保留所有未解决的伏笔。
只输出新的梗概。

【现有梗概】
${old}

【新的一章】${chapterTitle}
${chapterSummary}`,
    },
  ]
}

/** 从全部章节摘要重建梗概 */
export function rebuildGlobalSummaryPrompt(parts: string[]): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `以下是这部小说各章的摘要。请据此写出全书梗概。
要求：总长度不超过 800 字；越早的情节越精简，最近的情节保留更多细节；保留所有未解决的伏笔。
只输出梗概正文。

${parts.join('\n\n')}`,
    },
  ]
}

/** 人物状态更新（输出 JSON） */
export interface CharacterStateInput {
  name: string
  content: string
  currentState: string
}

export function characterStatePrompt(chapterTitle: string, chapterSummary: string, characters: CharacterStateInput[]): ChatMessage[] {
  const list = characters
    .map((c) => `- ${c.name}：${c.content.trim() || '（无设定）'}${c.currentState.trim() ? `；当前状态：${c.currentState.trim()}` : ''}`)
    .join('\n')
  return [
    {
      role: 'user',
      content: `下面是小说《${chapterTitle}》一章的摘要，以及本章出场人物的信息。请根据摘要更新人物的“当前状态”。
当前状态包括：所在位置、身体状况、情绪、持有的关键物品、与他人关系的变化。
只输出 JSON，格式：{"updates":[{"name":"人物名","current_state":"不超过100字"}]}
没有变化的人物不要输出，不要输出 JSON 以外的任何内容。

【本章摘要】
${chapterSummary}

【出场人物】
${list}`,
    },
  ]
}
