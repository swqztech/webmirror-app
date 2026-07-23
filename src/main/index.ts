import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync
} from 'fs'
import { createRequire } from 'node:module'
import { createServer, type Server } from 'http'
import express from 'express'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const require = createRequire(__filename)

async function loadScrape() {
  const unwrap = (mod: unknown): ((options: unknown) => Promise<unknown>) | null => {
    if (typeof mod === 'function') return mod as (options: unknown) => Promise<unknown>
    if (mod && typeof mod === 'object') {
      const d = (mod as { default?: unknown }).default
      if (typeof d === 'function') return d as (options: unknown) => Promise<unknown>
      if (d && typeof d === 'object' && typeof (d as { default?: unknown }).default === 'function') {
        return (d as { default: (options: unknown) => Promise<unknown> }).default
      }
    }
    return null
  }

  try {
    // CJS 互操作路径（electron-vite 主进程产物常见）
    const mod = require('website-scraper')
    const scrape = unwrap(mod)
    if (scrape) return scrape
  } catch {
    // 纯 ESM 环境走动态 import
  }

  const mod = await import('website-scraper')
  const scrape = unwrap(mod) ?? unwrap((mod as { default?: unknown }).default)
  if (!scrape) {
    throw new Error('website-scraper 加载失败：scrape is not a function')
  }
  return scrape
}

export type MirrorMeta = {
  id: string
  url: string
  title: string
  createdAt: number
  dirName: string
  savePath: string
  fileCount: number
  status: 'ready' | 'error'
  error?: string
}

export type CrawlOptions = {
  url: string
  maxDepth: number
  maxPages: number
  requestConcurrency: number
}

export type CrawlProgress = {
  phase: 'start' | 'request' | 'saving' | 'done' | 'error'
  running: boolean
  saved: number
  maxPages: number
  percent: number
  currentUrl?: string
  message?: string
  mirrorId?: string
  saveDir?: string
  log?: string
}

let mainWindow: BrowserWindow | null = null
let staticServer: Server | null = null
let staticPort = 0
let crawling = false
let servingDir = ''

function mirrorsRoot() {
  const root = join(app.getPath('userData'), 'mirrors')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function catalogPath() {
  return join(mirrorsRoot(), 'catalog.json')
}

function readCatalog(): MirrorMeta[] {
  const file = catalogPath()
  if (!existsSync(file)) return []
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as MirrorMeta[]
    if (!Array.isArray(data)) return []
    // 兼容旧数据：补全绝对路径
    return data.map((item) => ({
      ...item,
      savePath: item.savePath || join(mirrorsRoot(), item.dirName)
    }))
  } catch {
    return []
  }
}

function writeCatalog(list: MirrorMeta[]) {
  writeFileSync(catalogPath(), JSON.stringify(list, null, 2), 'utf8')
}

function safeHostDir(urlText: string) {
  let host = 'site'
  try {
    host = new URL(urlText).hostname.replace(/[^\w.-]+/g, '_')
  } catch {
    // ignore
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${host}_${stamp}`
}

function countFiles(dir: string): number {
  let n = 0
  if (!existsSync(dir)) return 0
  const walk = (p: string) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else n += 1
    }
  }
  walk(dir)
  return n
}

function normalizeUrl(input: string) {
  const raw = input.trim()
  if (!raw) throw new Error('请输入网站地址')
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const u = new URL(withProto)
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('只支持 http / https 地址')
  }
  return u.toString()
}

function sendProgress(payload: CrawlProgress) {
  mainWindow?.webContents.send('crawl:progress', payload)
}

async function ensureStaticServer(mirrorDir: string): Promise<number> {
  // 同一目录已在跑，直接复用端口
  if (staticServer && staticPort && servingDir === mirrorDir) {
    return staticPort
  }

  if (staticServer && staticPort) {
    await new Promise<void>((resolve) => {
      staticServer?.close(() => resolve())
    })
    staticServer = null
    staticPort = 0
    servingDir = ''
  }

  const expressApp = express()
  expressApp.use(express.static(mirrorDir, { index: ['index.html', 'index.htm'] }))
  expressApp.use((_req, res) => {
    const index = join(mirrorDir, 'index.html')
    if (existsSync(index)) res.sendFile(index)
    else res.status(404).send('未找到页面')
  })

  await new Promise<void>((resolve, reject) => {
    staticServer = createServer(expressApp)
    staticServer.once('error', reject)
    staticServer.listen(0, '127.0.0.1', () => {
      const addr = staticServer?.address()
      if (addr && typeof addr === 'object') {
        staticPort = addr.port
        servingDir = mirrorDir
        resolve()
      } else {
        reject(new Error('本地服务启动失败'))
      }
    })
  })

  return staticPort
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Web Mirror',
    backgroundColor: '#EEF3F8',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function openMirror(id: string) {
  const item = readCatalog().find((m) => m.id === id)
  if (!item) throw new Error('镜像不存在')
  const dir = join(mirrorsRoot(), item.dirName)
  return openMirrorDir(dir)
}

async function openMirrorDir(dir: string) {
  if (!dir || !existsSync(dir)) throw new Error('镜像目录不存在')
  const port = await ensureStaticServer(dir)
  const url = `http://127.0.0.1:${port}/`
  await shell.openExternal(url)
  return { url, port }
}

async function revealPath(dir: string) {
  if (!dir || !existsSync(dir)) throw new Error('目录不存在')
  await shell.openPath(dir)
  return true
}

async function startCrawl(options: CrawlOptions) {
  if (crawling) throw new Error('已有任务在进行，请稍候')
  crawling = true

  const url = normalizeUrl(options.url)
  const maxDepth = Math.min(Math.max(Number(options.maxDepth) || 1, 0), 5)
  const maxPages = Math.min(Math.max(Number(options.maxPages) || 50, 1), 800)
  const requestConcurrency = Math.min(Math.max(Number(options.requestConcurrency) || 2, 1), 6)

  const dirName = safeHostDir(url)
  const directory = join(mirrorsRoot(), dirName)
  if (existsSync(directory)) {
    rmSync(directory, { recursive: true, force: true })
  }

  let saved = 0
  const origin = new URL(url).origin

  const push = (partial: Partial<CrawlProgress> & Pick<CrawlProgress, 'phase' | 'message'>) => {
    const percent = Math.min(100, Math.round((saved / Math.max(maxPages, 1)) * 100))
    sendProgress({
      running: partial.phase !== 'done' && partial.phase !== 'error',
      saved,
      maxPages,
      percent: partial.phase === 'done' ? 100 : percent,
      saveDir: directory,
      ...partial
    })
  }

  push({
    phase: 'start',
    message: `开始抓取 ${url}`,
    log: `目标：${url}`
  })
  push({
    phase: 'start',
    message: `保存目录：${directory}`,
    log: `保存到：${directory}`
  })
  push({
    phase: 'start',
    message: `深度 ${maxDepth} · 上限 ${maxPages} · 并发 ${requestConcurrency}`,
    log: `参数：深度=${maxDepth}，资源上限=${maxPages}，并发=${requestConcurrency}`
  })

  try {
    const scrape = await loadScrape()

    class ProgressPlugin {
      apply(
        registerAction: (
          name: string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          handler: (params: any) => any
        ) => void
      ) {
        registerAction('beforeRequest', ({ resource, requestOptions }) => {
          const currentUrl =
            (typeof resource?.getUrl === 'function' ? resource.getUrl() : resource?.url) as
              | string
              | undefined
          push({
            phase: 'request',
            currentUrl,
            message: currentUrl ? `请求中：${currentUrl}` : '请求资源…',
            log: currentUrl ? `→ 请求 ${currentUrl}` : '→ 发起请求'
          })
          // website-scraper 要求必须返回 requestOptions，否则会解构失败
          return { requestOptions }
        })

        registerAction('onResourceSaved', ({ resource }) => {
          saved += 1
          const currentUrl =
            (typeof resource?.getUrl === 'function' ? resource.getUrl() : resource?.url) as
              | string
              | undefined
          const filename =
            (typeof resource?.getFilename === 'function'
              ? resource.getFilename()
              : resource?.filename) as string | undefined
          push({
            phase: 'saving',
            currentUrl,
            message: `已保存 ${saved}/${maxPages}`,
            log: filename
              ? `✓ 已保存 ${filename}${currentUrl ? ` ← ${currentUrl}` : ''}`
              : `✓ 已保存${currentUrl ? ` ${currentUrl}` : ''}（${saved}/${maxPages}）`
          })
        })

        registerAction('onResourceError', ({ resource, error }) => {
          const currentUrl =
            (typeof resource?.getUrl === 'function' ? resource.getUrl() : resource?.url) as
              | string
              | undefined
          const errMsg = error instanceof Error ? error.message : String(error || '未知错误')
          push({
            phase: 'saving',
            currentUrl,
            message: `资源失败：${errMsg}`,
            log: `✗ 失败 ${currentUrl || ''} ${errMsg}`
          })
        })
      }
    }

    await scrape({
      urls: [url],
      directory,
      recursive: maxDepth > 0,
      maxRecursiveDepth: maxDepth,
      requestConcurrency,
      ignoreErrors: true,
      urlFilter: (resourceUrl: string) => {
        try {
          const u = new URL(resourceUrl)
          if (u.origin !== origin) return false
          if (/\.(mp4|webm|mov|avi|mkv|zip|rar|7z|exe|dmg|iso)(\?|$)/i.test(u.pathname)) {
            return false
          }
          return saved < maxPages
        } catch {
          return false
        }
      },
      request: {
        headers: {
          'User-Agent': 'WebMirror/1.0 (+local archive; personal use; Electron)'
        }
      },
      plugins: [new ProgressPlugin()]
    })

    const fileCount = countFiles(directory)
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const meta: MirrorMeta = {
      id,
      url,
      title: new URL(url).hostname,
      createdAt: Date.now(),
      dirName,
      savePath: directory,
      fileCount,
      status: 'ready'
    }

    const catalog = readCatalog()
    catalog.unshift(meta)
    writeCatalog(catalog)

    push({
      phase: 'done',
      mirrorId: id,
      message: `完成，共 ${fileCount} 个文件`,
      log: `完成：共 ${fileCount} 个文件，目录 ${directory}`
    })

    return meta
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    push({
      phase: 'error',
      message,
      log: `错误：${message}`
    })
    if (existsSync(directory)) {
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    throw new Error(message)
  } finally {
    crawling = false
  }
}

function deleteMirror(id: string) {
  const catalog = readCatalog()
  const item = catalog.find((m) => m.id === id)
  if (!item) return false
  const dir = join(mirrorsRoot(), item.dirName)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  writeCatalog(catalog.filter((m) => m.id !== id))
  return true
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.codes.webmirror')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('mirrors:list', () => readCatalog())
  ipcMain.handle('mirrors:root', () => mirrorsRoot())
  ipcMain.handle('mirrors:delete', (_e, id: string) => deleteMirror(id))
  ipcMain.handle('mirrors:open', async (_e, id: string) => openMirror(id))
  ipcMain.handle('mirrors:openDir', async (_e, dir: string) => openMirrorDir(dir))
  ipcMain.handle('mirrors:reveal', async (_e, id: string) => {
    const item = readCatalog().find((m) => m.id === id)
    if (!item) throw new Error('镜像不存在')
    const dir = join(mirrorsRoot(), item.dirName)
    return revealPath(dir)
  })
  ipcMain.handle('mirrors:revealPath', async (_e, dir: string) => revealPath(dir))
  ipcMain.handle('mirrors:revealRoot', async () => {
    const root = mirrorsRoot()
    await shell.openPath(root)
    return root
  })
  ipcMain.handle('crawl:start', async (_e, options: CrawlOptions) => startCrawl(options))
  ipcMain.handle('crawl:isRunning', () => crawling)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (staticServer) {
    staticServer.close()
    staticServer = null
  }
})
