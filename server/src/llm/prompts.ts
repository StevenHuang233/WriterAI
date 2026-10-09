import type { ChatMessage } from './client.js'

export type SuggestLength = 'short' | 'medium' | 'long'

const INLINE_LENGTH: Record<SuggestLength, string> = {
  short: '10～30 个汉字，最多一个短句',
  medium: '15～60 个汉字，最多写到一句话或一个短句群结束',
  long: '30～120 个汉字，可以写两三个短句',
}

const CONTINUE_LENGTH: Record<SuggestLength, string> = {
  short: '100～200 个汉字',
  medium: '200～500 个汉字，可以包含多个自然段',
  long: '500～800 个汉字，可以包含多个自然段',
}

/** 实时提词 / 手动续写 的系统提示（长度可配置） */
export function suggestSystemPrompt(mode: 'inline' | 'continue', length: SuggestLength = 'medium'): string {
  const len = mode === 'inline' ? INLINE_LENGTH[length] : CONTINUE_LENGTH[length]
  return `你是一位小说写作助手${mode === 'inline' ? '，负责在作者停顿时给出接下来的一小段文字提示' : '，负责在作者要求时续写接下来的一段正文'}。
要求：
1. 只输出紧接在【正文】末尾之后的续写内容，不重复已有文字，不加任何解释、引号或标题。
2. 长度 ${len}。
3. 严格遵守设定与人物当前状态，不得与前情矛盾；不确定的信息不要编造新设定。
4. 保持与正文一致的人称、时态、文风。
5. 如果给出了【光标后文】，续写必须能自然衔接到它。`
}

/**
 * 文风分析：从作者自己的正文里总结文风特征，供后续提词模仿。
 * 输出 JSON + 一段可直接放进提示词的风格指令（note）。
 */
export function analyzeStylePrompt(sample: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `下面是同一位作者写的小说正文片段。请分析这位作者的文风，供之后的续写模仿。
只输出 JSON，格式：
{"perspective":"叙述视角与人称","sentence":"句式与节奏特征","wording":"用词倾向","dialogue":"对话与引号用法","rhetoric":"常用意象与修辞","avoid":"应当避免的写法","note":"可直接作为写作指令的风格要求，150～250 字，用中文，写成给模型的指令语气"}
不要输出 JSON 以外的任何内容。

${sample}`,
    },
  ]
}

/**
 * 从正文里识别反复出现的人物，供自动建人物卡。
 * 只输出 JSON：{"characters":[{"name":"","aliases":[],"role":"","appearance":"","personality":"","motivation":"","catchphrase":"","note":""}]}
 */
export function detectCharactersPrompt(sample: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `下面是小说正文片段。请找出其中反复出现或重要的人物（不要列只提一次的龙套，也不要列非人物）。
只输出 JSON，格式：
{"characters":[{"name":"姓名","aliases":["别名"],"role":"身份","appearance":"外貌（简）","personality":"性格","motivation":"动机目标","catchphrase":"口头禅或说话特点","note":"与剧情相关的补充"}]}
不要输出 JSON 以外的任何内容。

${sample}`,
    },
  ]
}

/** 根据正文补全单个人的设定卡 */
export function fillCharacterPrompt(name: string, sample: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `下面是小说中涉及“${name}”的正文片段。请据此补全这个人物的设定卡。
只输出 JSON，格式：
{"gender":"","age":"","role":"身份","appearance":"外貌","personality":"性格","motivation":"动机目标","catchphrase":"口头禅或说话特点","content":"设定正文（150～300 字，总结该人物的基本情况与剧情作用）"}
信息不足的字段留空，不要编造。不要输出 JSON 以外的任何内容。

${sample}`,
    },
  ]
}

/** 推断某个人物与其他已知人物的关系 */
export function inferRelationsPrompt(name: string, others: string[], sample: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `下面是小说正文片段，已有这些已知人物：${others.join('、')}。
请判断“${name}”与其中哪些人存在明确关系，并简要说明。
只输出 JSON，格式：{"relations":[{"name":"对方姓名（必须在已知人物中）","label":"关系，如：师徒、旧识、互有戒备"}]}
只写正文能看出来的关系，不要猜测。不要输出 JSON 以外的任何内容。

${sample}`,
    },
  ]
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

/**
 * 增量摘要：只把“上次摘要之后新增的正文”发给模型，与已有摘要合并。
 * 长章节可显著降低 token 消耗与耗时。
 */
export function incrementalChapterSummaryPrompt(oldSummary: string, newText: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `这是一章小说的已有摘要，以及这段摘要之后新写出的正文。请把新内容合并进摘要。
要求：
1. 150～300 字，按时间顺序概括关键事件。
2. 必须保留：人物的重要决定、关系变化、受伤/获得/失去的物品、新出现的伏笔与未解决的悬念。
3. 已有摘要中与新内容矛盾的地方以新内容为准；不写评价，不写文学性描写。
只输出更新后的摘要正文。

【已有摘要】
${oldSummary}

【新增正文】
${newText}`,
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
