# WriterAI 小说提词器

本地运行的网页写作应用：停笔片刻，AI 结合**上下文、设定库与前情摘要**，在光标处给出灰色提示，按 `Tab` 接受。

## 功能

- **停顿提词**：默认停止输入 4 秒后触发（可调 2–10 秒）；中文输入法组词时不触发；每次停顿只请求一次；连续忽略会自动拉长间隔
- **接受方式**：`Tab` 全部接受 · `Cmd/Ctrl + →` 接受到下一个标点 · `Esc` 忽略 · `Cmd/Ctrl + J` 手动提词 · `Cmd/Ctrl + Shift + J` 续写一段
- **设定库（Lorebook）**：人物 / 地点 / 物品 / 势力 / 世界观，支持别名；正文中出现名称或别名时自动带入上下文（关键词触发），可设常驻与优先级
- **历史压缩**：章节摘要 → 全书梗概（滚动合并）→ 人物当前状态自动更新；手改摘要自动锁定
- **双模型**：快速模型负责实时提词，强模型负责摘要与续写（可分别配置，例如快速用 DeepSeek / 本地 Ollama 小模型，强模型用大模型）
- 导出 txt / markdown，深色主题，数据存本地 SQLite

## 快速开始

要求 Node.js ≥ 20.19（建议 22）。

```bash
npm install
cp .env.example .env   # 填入模型配置
npm run dev            # 打开 http://localhost:5173
```

生产模式（单端口）：

```bash
npm run build
npm start              # http://127.0.0.1:8787
```

## 模型配置（.env）

| 变量 | 说明 |
|---|---|
| `FAST_BASE_URL` / `FAST_API_KEY` / `FAST_MODEL` | 快速模型：实时提词（OpenAI 兼容接口） |
| `STRONG_BASE_URL` / `STRONG_API_KEY` / `STRONG_MODEL` | 强模型：摘要 / 梗概 / 人物状态 / 续写 |

兼容 DeepSeek、通义千问、Kimi、OpenAI 以及本地 Ollama / LM Studio（示例见 `.env.example`）。密钥只保存在 `.env`，不会发送到前端。

## 使用建议

1. 建项目后先在右侧「风格」页写**故事简介**与**风格指令**
2. 在「设定」页添加主要人物（名称、别名、设定、常驻开关）
3. 开始写作。前几章写完后，「前情」页会出现自动摘要；越往后，提词越"记得"前面的剧情
4. 状态栏可看到本次提词用到了哪些设定

## 架构

- `server/`：Hono + SQLite（better-sqlite3）。`src/context/` 是上下文组装器（预算裁剪 + 关键词触发），`src/jobs/` 是后台摘要队列
- `web/`：Vite + React + TipTap。`src/editor/` 是空闲触发器、幽灵文本扩展与后处理
- 详细设计见 [docs/DESIGN.md](docs/DESIGN.md)

```bash
npm test        # vitest：上下文组装、关键词触发、预算裁剪、空闲触发器、后处理
npm run typecheck
```

## 安全说明

- 后端仅监听 `127.0.0.1`，SQL 全部参数绑定，接口入参 Zod 校验
- 模型输出与用户数据一律按纯文本渲染
- 尚未实现：预请求（提前发请求掩盖延迟）、向量检索设定、多候选切换
