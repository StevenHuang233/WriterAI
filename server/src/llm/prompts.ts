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
      content: `下面是同一位作者写的小说正文。请用 150～250 字概括这位作者的文风，写成给写作模型看的指令：包括叙述视角与人称、句式与节奏、用词倾向、对话与引号用法、应当避免的写法。
只输出这段指令，不要解释，不要分条，不要输出 JSON。

${sample}`,
    },
  ]
}

/**
 * 从正文里识别反复出现的人物，供自动建人物卡。
 * 用标记行输出而不是 JSON——实测该模型被要求输出 JSON 时会把 token 消耗在思考上导致返回空。
 * 格式：【人物】姓名 ｜【别名】… ｜【身份】… 等，多个人物之间空一行。
 */
export function detectCharactersPrompt(sample: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `下面是小说正文片段。请找出其中反复出现或重要的人物（不要列只提一次的龙套，也不要列非人物）。

每行写一个，格式为：姓名｜一句话身份（如：林墨｜追查旧案的剑客）
不要输出任何解释、标题或序号，也不要输出除名单以外的内容。

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
按下面的格式输出，不要输出任何解释或标题：
【性别】
【年龄】
【身份】
【外貌】
【性格】
【动机】
【口头禅】
【设定】150～300 字，总结该人物的基本情况与剧情作用

信息不足的字段留空，不要编造。

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

每行一条，格式为：对方姓名｜关系（如：师徒、旧识、互有戒备）
只写正文能看出来的关系，不要猜测；对方姓名必须在已知人物中。不要输出任何解释或标题。

${sample}`,
    },
  ]
}

/** 章节摘要 */
/**
 * 分层摘要：一次调用产出三个压缩层级，供上下文按“近详远略”取用。
 * summary：完整摘要（150～300 字）；brief：一句话（30～60 字）；micro：极简（10～20 字）
 */
export function chapterSummaryPrompt(text: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `请为以下小说章节生成三个层级的摘要。只按下面的格式输出三行，每行一个层级，不要输出任何其他内容：
【完整】150～300 字，按时间顺序概括关键事件，保留人物重要决定、关系变化、物品得失、伏笔与悬念
【一句话】30～60 字
【极简】10～20 字，只保留最关键的动向或结果

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
      content: `这是一章小说的已有摘要，以及这段摘要之后新写出的正文。请把新内容合并进摘要，并按下面的格式输出三个层级，只输出这三行，不要输出任何其他内容：
【完整】150～300 字，按时间顺序；已有摘要与新内容矛盾时以新内容为准
【一句话】30～60 字
【极简】10～20 字

【已有摘要】
${oldSummary}

【新增正文】
${newText}`,
    },
  ]
}

/**
 * 远段合段压缩：把连续的若干章压缩成一段连贯的话。
 * 逐章罗列的极简摘要会把剧情切碎，合段后仍是一条可读的前情。
 */
export function segmentCompressPrompt(
  chapters: { order: number; title: string; summary: string }[],
  maxChars: number,
): ChatMessage[] {
  const parts = chapters
    .map((c) => `第${c.order}章《${c.title}》：${c.summary.trim()}`)
    .join('\n')
  return [
    {
      role: 'user',
      content: `把下面几章的摘要连成一段 100～200 字的前情概述，供续写时参考。

直接写成一段通顺的话，不要标题、不要编号、不要分点、不要解释。
按顺序串成一条主线，保留因果、人物处境变化、物品得失和未解的悬念；用人物名字而不是代词。

${parts}`,
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
