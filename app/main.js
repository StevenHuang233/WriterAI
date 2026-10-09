const { app, BrowserWindow, shell, dialog } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')
const fs = require('node:fs')

const PORT = Number(process.env.WRITERAI_PORT || 8787)
let serverProc = null
let win = null

const isPackaged = Boolean(app.isPackaged)
/** 未打包：仓库根；打包后：resources 目录（server/dist、web/dist 都拷在这里） */
const ROOT = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js')

/**
 * Finder 启动时 PATH 很短，需要兜底常见 node 路径。
 * 后端用系统 Node 拉起（better-sqlite3 是原生模块，与 Electron 内置 Node 的 ABI 不匹配）。
 */
function findNode() {
  const win = process.platform === 'win32'
  const candidates = [
    process.env.WRITERAI_NODE,
    ...(win
      ? ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe']
      : ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/opt/local/bin/node']),
    win ? 'node.exe' : 'node',
  ].filter(Boolean)
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  // 最后交给 PATH 解析（Windows 会按 PATHEXT 补 .exe）
  return win ? 'node.exe' : 'node'
}

function serverAlive() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/settings', timeout: 800 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForServer(timeoutMs = 40000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await serverAlive()) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

function startServer() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    dialog.showErrorBox(
      '缺少后端构建产物',
      `找不到 ${SERVER_ENTRY}\n请先在项目根目录执行：npm run build`,
    )
    return false
  }
  const node = findNode()
  serverProc = spawn(node, [SERVER_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = (tag) => (buf) => {
    const line = String(buf).trim()
    if (line) console.log(`[server:${tag}] ${line}`)
  }
  serverProc.stdout.on('data', log('out'))
  serverProc.stderr.on('data', log('err'))
  serverProc.on('error', (e) => {
    dialog.showErrorBox('后端启动失败', `无法启动 Node：${e.message}\n需要本机安装 Node 18+（桌面版用它运行本地服务）。`)
  })
  serverProc.on('exit', (code) => {
    console.log(`[server] 退出，code=${code}`)
    serverProc = null
  })
  return true
}

function stopServer() {
  if (!serverProc) return
  try {
    if (process.platform === 'win32') {
      // Windows 没有 SIGTERM：用 taskkill 连子进程一起结束
      spawn('taskkill', ['/pid', String(serverProc.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      serverProc.kill('SIGTERM')
    }
  } catch {
    /* ignore */
  }
  serverProc = null
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'WriterAI 小说提词器',
    backgroundColor: '#1c1b19',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 外链用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  await win.loadURL(`http://127.0.0.1:${PORT}`)
  win.on('closed', () => {
    win = null
  })
}

app.on('before-quit', stopServer)
app.on('window-all-closed', () => {
  stopServer()
  app.quit()
})

app.whenReady().then(async () => {
  // 后端已在运行（比如手动 npm run dev）就直接复用
  let ready = await serverAlive()
  if (!ready) {
    ready = startServer() && (await waitForServer())
  }
  if (!ready) {
    dialog.showErrorBox('后端启动失败', `无法连接到 http://127.0.0.1:${PORT}\n请检查 .env 配置或查看控制台输出。`)
    app.quit()
    return
  }
  await createWindow()
})
