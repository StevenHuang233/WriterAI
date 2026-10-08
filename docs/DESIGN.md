# WriterAI 小说提词器 —— 设计与实施方案

> 本文档用于交接给实施者（其他模型或开发者），按文档逐阶段实现即可。
> 远程仓库：`git@github.com:StevenHuang233/WriterAI.git`（已确认存在且为空，本机 SSH 已认证为 StevenHuang233）
> 本机环境：Node v22.12.0、npm 10.9.0、git 2.50.1；未安装 `gh`，使用 SSH 推送。
> 本地工作目录：`/Users/huangjiajie/Desktop/小说提词器`（目前只有本文档）

---

## 1. 产品目标

一个**本地启动的网页应用**，作者在编辑器里写小说，**停顿一段时间后**，AI 根据以下信息在光标处给出灰色提示文本（幽灵文本），按 Tab 接受：

1. 光标前后的正文
2. 历史压缩信息（全书梗概 + 章节摘要 + 人物当前状态）
3. 设定库（世界观、人物、地点、物品、势力等）
4. 风格指令（文风、视角、节奏）

### 非目标（MVP 不做）
- 多用户、登录、云同步
- 移动端适配
- 向量检索（先用关键词触发，留扩展点）
- 导出 epub/docx（只做导出 txt/markdown）

---

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Vite + React 18 + TypeScript | |
| 编辑器 | TipTap 2（ProseMirror） | 用 Decoration 实现幽灵文本 |
| 样式 | Tailwind CSS | 简洁、深浅色主题 |
| 状态 | Zustand | |
| 后端 | Node 22 + Hono（`@hono/node-server`） + TypeScript | 代理 LLM，存储数据 |
| 存储 | SQLite（`better-sqlite3`） | 文件位于 `data/writerai.db` |
| 数据校验 | Zod | 所有 API 入参校验 |
| LLM | OpenAI 兼容接口（`openai` npm 包，自定义 baseURL） | 兼容 DeepSeek、通义、Kimi、Ollama、LM Studio 等 |
| 测试 | Vitest | 上下文组装、触发器、关键词匹配的单测 |
| 开发启动 | `concurrently` | 一条命令同时起前后端 |

### 仓库结构（npm workspaces）

```
WriterAI/
├─ package.json            # workspaces: ["server", "web"]；scripts: dev / build / start / test
├─ .env.example
├─ .gitignore              # node_modules, dist, .env, data/*.db*
├─ README.md               # 中文：安装、配置、启动、截图位
├─ docs/DESIGN.md          # 本文档
├─ data/.gitkeep
├─ server/
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ src/
│     ├─ index.ts          # 启动，监听 127.0.0.1
│     ├─ env.ts            # 读取并校验环境变量
│     ├─ db/
│     │  ├─ schema.sql
│     │  ├─ index.ts       # 连接、迁移
│     │  └─ repo.ts        # 预编译语句，全部参数绑定
│     ├─ llm/
│     │  ├─ client.ts      # fast / strong 两个模型配置
│     │  └─ prompts.ts     # 提示词模板
│     ├─ context/
│     │  ├─ builder.ts     # 上下文组装器（核心）
│     │  ├─ lore-match.ts  # 设定关键词触发
│     │  └─ budget.ts      # 长度预算与裁剪
│     ├─ jobs/
│     │  └─ summarizer.ts  # 后台摘要队列
│     └─ routes/
│        ├─ projects.ts
│        ├─ chapters.ts
│        ├─ lore.ts
│        ├─ suggest.ts     # SSE 流式
│        └─ settings.ts
│     └─ __tests__/
└─ web/
   ├─ package.json
   ├─ vite.config.ts       # /api 代理到后端
   └─ src/
      ├─ main.tsx / App.tsx
      ├─ api/              # fetch 封装、SSE 读取
      ├─ store/
      ├─ editor/
      │  ├─ Editor.tsx
      │  ├─ ghost-text.ts      # TipTap 扩展：幽灵文本 Decoration + 键位
      │  └─ idle-trigger.ts    # 空闲触发器（纯逻辑，可单测）
      ├─ components/
      │  ├─ ChapterList.tsx
      │  ├─ LorePanel.tsx
      │  ├─ SummaryPanel.tsx
      │  ├─ StylePanel.tsx
      │  ├─ SettingsDialog.tsx
      │  └─ StatusBar.tsx
      └─ __tests__/
```

### 启动方式
```bash
npm install
cp .env.example .env    # 填入 API Key 等
npm run dev             # 前端 http://localhost:5173，后端 http://127.0.0.1:8787
npm run build && npm start   # 生产模式：后端同时托管 web/dist 静态文件，单端口 8787
```

---

## 3. 配置与安全

### `.env.example`
```ini
PORT=8787
# 快速模型：用于实时提词（低延迟）
FAST_BASE_URL=https://api.deepseek.com/v1
FAST_API_KEY=
FAST_MODEL=deepseek-chat
# 强模型：用于摘要、人物状态更新、手动续写
STRONG_BASE_URL=https://api.deepseek.com/v1
STRONG_API_KEY=
STRONG_MODEL=deepseek-chat
# 本地模型示例（Ollama）：
# FAST_BASE_URL=http://127.0.0.1:11434/v1
# FAST_API_KEY=ollama
# FAST_MODEL=qwen2.5:7b
```

### 安全要求（必须遵守）
1. **密钥只在 `.env`**，不进数据库、不返回给前端、不写日志。`/api/settings` 只返回“是否已配置”布尔值和模型名。
2. **baseURL 只来自 `.env`**，前端不能在请求里指定任意 URL（防 SSRF）。允许 localhost 是因为要支持 Ollama，这是本机用户自己配置的。
3. 后端**只监听 `127.0.0.1`**。
4. SQL **全部用 better-sqlite3 预编译语句 + 参数绑定**，禁止字符串拼接 SQL。
5. 所有路由入参用 **Zod** 校验，限制长度（正文单章上限 20 万字、设定条目内容上限 2 万字）。
6. 前端渲染 LLM 输出和用户数据时**只作为纯文本**，不使用 `dangerouslySetInnerHTML`；TipTap 插入时用 `insertContent` 的文本节点，不解析 HTML。
7. 不执行任何 shell 命令。

---

## 4. 数据模型（`schema.sql`）

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',        -- 作者手写的故事简介
  global_summary TEXT NOT NULL DEFAULT '',  -- AI 维护的全书滚动梗概
  style_note TEXT NOT NULL DEFAULT '',      -- 风格指令（Author's Note）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',          -- 纯文本，段落用 \n 分隔
  summary TEXT NOT NULL DEFAULT '',
  summary_locked INTEGER NOT NULL DEFAULT 0, -- 作者手动改过摘要后锁定，AI 不覆盖
  summarized_len INTEGER NOT NULL DEFAULT 0, -- 上次摘要时的正文长度
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE lore_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('character','location','item','faction','world','other')),
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',        -- JSON 数组：别名、称呼
  content TEXT NOT NULL DEFAULT '',          -- 设定正文
  current_state TEXT NOT NULL DEFAULT '',    -- 人物当前状态（AI 可更新，作者可改）
  always_on INTEGER NOT NULL DEFAULT 0,      -- 常驻上下文
  priority INTEGER NOT NULL DEFAULT 0,       -- 预算不足时高优先保留
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE suggestion_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted','partial','dismissed')),
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);
```

JSON 字段读取时用 `JSON.parse` 并以 Zod 校验为字符串数组，异常时回退为 `[]`。

---

## 5. 核心一：空闲触发器（前端 `idle-trigger.ts`）

写成**与编辑器解耦的纯逻辑类**，便于单测（用 Vitest 假定时器）。

### 规则
| 规则 | 说明 |
|---|---|
| 空闲阈值 | 默认 4000ms，设置里可调 2000–10000ms |
| 重置计时的事件 | 文本变化、粘贴、撤销/重做、光标移动、选区变化 |
| 输入法组词 | `compositionstart` 到 `compositionend` 期间**不计时**；`compositionend` 视为一次输入 |
| 触发前提 | 编辑器有焦点；`document.visibilityState === 'visible'`；选区为空；正文非空 |
| 每次空闲只触发一次 | 记录 `firedForVersion`，文档版本不变不重复触发 |
| 作废 | 任何输入 → `AbortController.abort()` 进行中的请求，并清除幽灵文本 |
| 过期丢弃 | 响应到达时若文档版本已变，丢弃 |
| 退避 | 连续 3 次被忽略（dismissed），阈值 ×1.5（上限 15s）；一次接受即恢复默认 |
| 预请求（可选开关，默认关） | 空闲 1500ms 先发请求，到阈值时再显示 |
| 手动触发 | `Cmd/Ctrl + J` 立即请求，无视阈值和“只触发一次”规则 |
| 开关 | 状态栏一键暂停自动提词 |

### 接口
```ts
type TriggerState = 'idle' | 'waiting' | 'requesting' | 'showing' | 'paused';

class IdleTrigger {
  constructor(opts: { idleMs: number; onFire: (signal: AbortSignal, version: number) => void });
  notifyActivity(): void;          // 任何输入/光标变化
  compositionStart(): void;
  compositionEnd(): void;
  setFocus(f: boolean): void;
  setHasSelection(s: boolean): void;
  reportOutcome(o: 'accepted' | 'partial' | 'dismissed'): void;
  manualFire(): void;
  pause(): void; resume(): void;
  get version(): number;
  get state(): TriggerState;
  dispose(): void;
}
```

---

## 6. 核心二：幽灵文本（TipTap 扩展 `ghost-text.ts`）

- 用 ProseMirror `Plugin` + `Decoration.widget` 在光标位置渲染灰色 `<span>`（文本通过 `textContent` 设置，**不用 innerHTML**）。
- 流式到达时逐步更新幽灵文本内容。
- 键位：
  - `Tab`：全部接受（插入纯文本，`\n` 拆为新段落）
  - `Cmd/Ctrl + →`：接受到下一个中文/英文标点（`，。！？；：、…—”」』,.!?;:`）为止，剩余部分继续显示
  - `Esc`：忽略（记 dismissed）
  - 任意其他输入：清除（记 dismissed）
  - 若用户输入的字符恰好是幽灵文本的首字符，则“吃掉”该字符、保留剩余提示（类 Copilot 行为），不重新请求
- 幽灵文本显示时 `Tab` 才被拦截，否则保持默认行为。

---

## 7. 核心三：上下文组装器（后端 `context/builder.ts`）

### 输入
```ts
interface SuggestRequest {
  projectId: string;
  chapterId: string;
  prefix: string;   // 光标前文本，前端截取最近 3000 字
  suffix: string;   // 光标后文本，前端截取最近 500 字
  mode: 'inline' | 'continue';  // inline=实时提词(fast)，continue=手动续写一段(strong)
}
```

### 组装顺序与预算（单位：字符，中文约 1 字≈1 token 估算）

前面的块变化慢 → 利于 API 前缀缓存；越靠近末尾对生成影响越大。

| # | 块 | inline 预算 | continue 预算 | 来源 |
|---|---|---|---|---|
| 1 | 系统指令 | 固定 | 固定 | `prompts.ts` |
| 2 | 故事简介 | 300 | 800 | `projects.synopsis` |
| 3 | 常驻设定 | 800 | 2000 | `always_on=1` 的条目 |
| 4 | 全书梗概 | 600 | 1500 | `projects.global_summary` |
| 5 | 前几章摘要 | 600（前 2 章） | 2000（前 5 章） | `chapters.summary`，按顺序 |
| 6 | 触发设定 | 1200 | 3000 | 关键词匹配到的条目（含 `current_state`） |
| 7 | 风格指令 | 300 | 500 | `projects.style_note` |
| 8 | 光标后文 | 300 | 500 | `suffix` |
| 9 | 光标前文 | 1500 | 3000 | `prefix` 末尾截取，从段落边界开始 |

超预算时按以下顺序裁剪：5 → 4 → 6（按 priority 低者先删）→ 3 → 2；**8、9、7 不裁**。

### 设定触发（`lore-match.ts`）
- 扫描范围：`prefix` 最后 2000 字 + `suffix`。
- 匹配词：`name` + `aliases`，按长度降序匹配，避免“张三丰”被“张三”抢先。
- 单字名（长度 1）默认不参与匹配，防止误触发。
- 排序：`priority` 降序 → 最后出现位置越靠近光标越优先。
- 返回命中条目及其命中词，用于前端“本次提词使用了哪些设定”的可视化（调试面板）。
- 留接口 `interface LoreRetriever { retrieve(text): LoreEntry[] }`，后续可加向量检索实现。

### 输出格式（发给 LLM 的 messages）
```
system: <系统指令>
user:
【故事简介】...
【常驻设定】...
【全书梗概】...
【前情摘要】第N章《标题》：...
【相关设定】人物·林墨（别名：小墨）：... 当前状态：...
【风格要求】...
【光标后文】（续写内容需能自然衔接到这里）...
【正文】...（结尾即光标位置）
```

### 单测要求
- 预算裁剪顺序正确
- 别名匹配、长名优先、单字名忽略
- 空设定/空摘要时不输出空标题块
- prefix 截取从段落边界开始

---

## 8. 提示词模板（`llm/prompts.ts`）

### 8.1 实时提词（inline，fast 模型）
```
你是一位小说写作助手，负责在作者停顿时给出接下来的一小段文字提示。
要求：
1. 只输出紧接在【正文】末尾之后的续写内容，不重复已有文字，不加任何解释、引号或标题。
2. 长度 15～60 个汉字，最多写到一句话或一个短句群结束。
3. 严格遵守设定与人物当前状态，不得与前情矛盾；不确定的信息不要编造新设定。
4. 保持与正文一致的人称、时态、文风。
5. 如果给出了【光标后文】，续写必须能自然衔接到它。
```
参数：`temperature 0.8`，`max_tokens 120`，`stop: ["\n\n"]`，`stream: true`。
后处理：去掉首尾引号、去掉与 prefix 末尾重叠的部分、去掉与 suffix 开头重复的部分、截断到最后一个完整标点。

### 8.2 手动续写（continue，strong 模型）
同上，但长度改为 200～500 字，`max_tokens 1000`，不设 `\n\n` 停止。结果以幽灵文本显示，接受方式相同。

### 8.3 章节摘要（strong 模型，非流式）
```
请为以下小说章节写摘要，供后续写作时回顾前情使用。
要求：
1. 150～300 字，按时间顺序概括关键事件。
2. 必须保留：人物的重要决定、关系变化、受伤/获得/失去的物品、新出现的伏笔与未解决的悬念。
3. 不写评价，不写文学性描写。
只输出摘要正文。
```

### 8.4 全书梗概滚动更新（strong 模型）
输入：旧的 `global_summary` + 最新完成摘要的章节摘要。
```
下面是小说到目前为止的全书梗概，以及新的一章摘要。请将新内容合并进梗概。
要求：总长度不超过 800 字；越早的情节越精简，最近的情节保留更多细节；保留所有未解决的伏笔。
只输出新的梗概。
```

### 8.5 人物状态更新（strong 模型，输出 JSON）
输入：本章摘要 + 本章出现的人物条目（name、content、current_state）。
```
根据本章摘要，更新出场人物的“当前状态”（位置、身体状况、情绪、持有的关键物品、与他人关系的变化）。
只输出 JSON：{"updates":[{"name":"人物名","current_state":"不超过100字"}]}
没有变化的人物不要输出。
```
解析时用 Zod 校验；`name` 必须匹配已有条目，否则丢弃；**不自动创建新条目**。更新前把旧状态写入前端可见的“变更记录”（MVP 可只在响应里返回 diff，由前端提示“已更新 N 个人物状态”并允许撤销）。

---

## 9. 后台摘要队列（`jobs/summarizer.ts`）

- 触发条件（任一）：
  - 章节正文长度比 `summarized_len` 增长 ≥ 1500 字，且该章 60 秒内无保存；
  - 用户切换到其他章节，且该章自上次摘要后有 ≥ 300 字变化；
  - 用户点击“立即摘要”。
- `summary_locked=1` 时跳过章节摘要，但仍可更新梗概和人物状态（使用锁定的摘要）。
- 流程：章节摘要 → 全书梗概合并 → 人物状态更新。
- 进程内串行队列，同一章节去重；失败重试 1 次，失败信息通过 `/api/jobs` 供前端状态栏展示。
- 注意：重写旧章节时，全书梗概无法精确“局部替换”，提供“从全部章节摘要重建梗概”按钮。

---

## 10. API 设计

所有响应 JSON；错误统一 `{ error: { code, message } }`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 新建 |
| GET/PATCH/DELETE | `/api/projects/:id` | 含 synopsis、style_note、global_summary |
| POST | `/api/projects/:id/rebuild-summary` | 从各章摘要重建梗概 |
| GET | `/api/projects/:id/chapters` | 章节列表（不含正文） |
| POST | `/api/projects/:id/chapters` | 新建章节 |
| GET/PATCH/DELETE | `/api/chapters/:id` | PATCH 支持 content、title、summary、summary_locked、sort_order |
| POST | `/api/chapters/:id/summarize` | 立即摘要 |
| GET | `/api/projects/:id/lore` | 设定列表 |
| POST | `/api/projects/:id/lore` | 新建条目 |
| PATCH/DELETE | `/api/lore/:id` | |
| POST | `/api/suggest` | **SSE**：`event: meta`（命中设定、上下文长度）→ 多个 `event: delta` → `event: done` / `event: error`；客户端断开时后端必须 abort 上游请求 |
| POST | `/api/suggest/feedback` | 记录 accepted / partial / dismissed |
| GET | `/api/settings` | 返回模型名、是否已配置 key（不返回 key） |
| GET | `/api/jobs` | 后台任务状态 |
| GET | `/api/projects/:id/export?format=txt\|md` | 导出 |

所有带 `:id` 的子资源操作需校验归属（例如更新 lore 时确认其 `project_id` 与请求一致），避免越权修改。

### 正文保存
- 前端编辑后防抖 1000ms 自动 PATCH 保存，状态栏显示“已保存 / 保存中”。
- 同时写 `localStorage` 草稿兜底，加载时若草稿比服务器新则提示恢复。

---

## 11. 界面布局

```
┌──────────────────────────────────────────────────────────────────┐
│ WriterAI ▾项目名        第3章 · 本章 3,215 字 · 全书 52,104 字   ⚙ │
├────────────┬───────────────────────────────────┬─────────────────┤
│ 章节        │                                   │ [设定][摘要][风格]│
│ ▸ 第1章     │   正文编辑区（居中，最大宽 760px）   │                 │
│ ▸ 第2章     │   ……林墨推开门，屋里一片漆黑。     │ 设定库：         │
│ ● 第3章     │   他摸索着点亮油灯，░░░灰色提示░░░  │  人物 / 地点 /…  │
│ + 新章节    │                                   │  搜索、常驻开关   │
│            │                                   │                 │
├────────────┴───────────────────────────────────┴─────────────────┤
│ 自动提词: 开 ⏸ │ 状态: 等待中… │ 本次使用设定: 林墨, 青石镇 │ 已保存 │
└──────────────────────────────────────────────────────────────────┘
```

- **设定面板**：按类型分组；每条可编辑 name、aliases（标签输入）、content、current_state、always_on、priority、enabled。
- **摘要面板**：全书梗概（可编辑）、各章摘要（可编辑，编辑后自动锁定，带解锁按钮）、“立即摘要”“重建梗概”按钮。
- **风格面板**：故事简介、风格指令。
- **设置弹窗**：空闲阈值滑块、预请求开关、提示长度（短/中）、显示当前模型名与 key 是否配置（只读）。
- 状态栏显示触发器状态和本次命中的设定，便于作者理解 AI 为什么这样提示。
- 首次进入无项目时，引导创建项目；未配置 key 时顶部显示醒目提示，并说明如何编辑 `.env`。
- 字体：正文使用衬线中文字体栈（`"Noto Serif SC", "Songti SC", serif`），行高 1.9，字号 18px 可调。
- 支持浅色/深色主题。

---

## 12. 实施阶段与验收标准

每个阶段完成后提交一次 commit（Conventional Commits，英文或中文均可）。

### 阶段 0：仓库初始化
- 创建 npm workspaces 结构、TypeScript、ESLint/Prettier（可选）、`.gitignore`、`.env.example`、README。
- `git init -b main`，`git remote add origin git@github.com:StevenHuang233/WriterAI.git`。
- **验收**：`npm install && npm run dev` 能同时起前后端，访问页面显示占位界面。

### 阶段 1：数据与基础 CRUD
- SQLite 建表与迁移，项目、章节、设定 CRUD，Zod 校验。
- 前端三栏布局、章节列表、TipTap 编辑器、自动保存、设定面板、风格面板。
- **验收**：可新建项目、章节、设定条目；刷新后数据仍在；`.env` 和 `data/*.db` 不被 git 追踪。

### 阶段 2：实时提词
- `IdleTrigger` + 单测；幽灵文本扩展；上下文组装器 + 单测；`/api/suggest` SSE；反馈记录；状态栏。
- **验收**：
  - 停顿 4 秒出现灰色提示，Tab 接受，Cmd+→ 部分接受，Esc 忽略；
  - 中文输入法组词时不会触发；
  - 停顿期间只请求一次，打字立即中断请求；
  - 状态栏显示命中的设定；
  - `npm test` 通过。

### 阶段 3：历史压缩
- 后台摘要队列、章节摘要、全书梗概、人物状态更新、摘要面板、重建梗概。
- **验收**：写满 1500 字并停顿 60 秒后，摘要自动生成；下一章提词时上下文中包含该摘要；人物状态更新后在设定面板可见并可撤销。

### 阶段 4：完善
- 手动续写（Cmd+Shift+J，strong 模型）、退避策略、预请求开关、设置弹窗、导出 txt/md、深色主题、生产模式单端口托管。
- **验收**：`npm run build && npm start` 后访问 `http://127.0.0.1:8787` 功能完整。

### 阶段 5：推送
```bash
git add -A
git commit -m "..."
git push -u origin main
```
推送前确认 `git status` 中没有 `.env`、数据库文件、`node_modules`。

---

## 13. 云端存储（已实现）

- **快照式同步**：本地全部数据导出为单个 JSON 快照（`writerai-sync.json`），推送到云端；恢复时整体导入。比逐条同步简单可靠，且适用于任何能存文件的存储
- **适配器**：`server/src/sync/providers.ts` 定义统一接口 `put / get / test`
  - `local`：本地文件夹或网盘同步目录
  - `s3`：aws4fetch 签名，兼容 S3 / R2 / OSS / COS / MinIO
  - `webdav`：Basic 鉴权 + PUT/GET
  - `gist`：GitHub API，首次上传自动创建 Gist 并回写 id
- **配置**：`data/sync-config.json`（chmod 600）。密钥只存服务端，返回前端前打码（`••••••`），前端回填打码值时保留原密钥
- **安全**：云端数据属于不可信输入，导入前用 Zod 严格校验（版本、字段、枚举、长度）
- **路由**：`GET/PUT /api/sync/config`、`POST /api/sync/test`、`POST /api/sync/push`、`GET /api/sync/remote`、`POST /api/sync/pull?mode=merge|replace`
- **自动备份**：`server/src/jobs/autoSync.ts`，正文保存时 `markDirty()`，每分钟检查，满足间隔且脏时推送
- **注意**：项目列表页也必须能打开设置，否则数据全部丢失后无法进入界面执行恢复

## 14. 后续可扩展（不在 MVP 内）
- 向量检索：设定条目、历史段落 embedding，补充关键词触发漏掉的内容。
- 多候选：一次生成 3 个候选，`Alt+]` 切换。
- 大纲模式：章节大纲作为上下文块，续写朝大纲目标推进。
- 根据 `suggestion_logs` 的接受率自动调节阈值和提示长度。
- Tauri 打包为桌面应用。
