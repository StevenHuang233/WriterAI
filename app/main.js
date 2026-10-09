/**
 * WriterAI 桌面版（Electron）
 *
 * 说明：后端依赖 better-sqlite3（原生模块），直接用 Electron 自带的 Node 运行会 ABI 不匹配，
 * 因此这里用系统已安装的 Node 启动后端，Electron 只负责窗口与本地 UI。
 */
const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js')
const PORT = Number(process.env.WRITERAI_PORT || 8787)
const URL = `http://127.0.0.1:${PORT}`

let serverProc = null
let quitting = false

/** 找到可用的系统 node（Electron 从 Finder 启动时 PATH 可能很短） */
function findNode() {
  const candidates = [
    process.env.WRITERAI_NODE,
    'node',
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    path.join(process.env.HOME || '', '.nvm/versions/node'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (c === 'node') return c
    if (fs.existsSync(c)) return c
  }
  return 'node'
}

function waitForServer(timeoutMs = 30000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`${URL}/api/settings`, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve(true)
        else retry()
      })
      req.on('error', retry)
      req.setTimeout(1000, () => req.destroy())
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('后端启动超时'))
        return
      }
      setTimeout(check, 300)
    }
    check()
  })
}

async function startServer() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error('缺少 server/dist/index.js，请先执行 npm run build')
  }
  const node = findNode()
  serverProc = spawn(node, [SERVER_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  serverProc.on('exit', (code) => {
    if (!quitting && code !== 0) {
      dialog.showErrorBox('后端已退出', `后端进程退出（代码 ${code}），应用即将关闭。`)
      app.quit()
    }
  })
  await waitForServer()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: 'WriterAI 小说提词器',
    backgroundColor: '#f7f5f0',
    webPreferences: {
      nodeIntegration: false,
      contextIsolated: true,
      // 页面只访问本地后端
      sandbox: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadURL(URL)
  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    // 关闭窗口即退出应用
    quitting = true
    app.quit()
  })
}

app.whenReady().then(async () => {
  try {
    await startServer()
    createWindow()
  } catch (e) {
    dialog.showErrorBox('启动失败', String(e && e.message ? e.message : e))
    app.quit()
  }
})

app.on('before-quit', () => {
  quitting = true
  if (serverProc && !serverProc.killed) {
    try {
      process.kill(-serverProc.pid)
    } catch {
      serverProc.kill()
    }
  }
})

app.on('window-all-closed', () => {
  app.quit()
})
