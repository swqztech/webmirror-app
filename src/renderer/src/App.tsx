import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

type MirrorMeta = {
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

type CrawlProgress = {
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

type LogLine = {
  id: string
  time: string
  text: string
}

const LAST_URL_KEY = 'webmirror:last-url'

function formatTime(ts: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts))
}

function nowClock() {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date())
}

function readLastUrl() {
  try {
    const saved = localStorage.getItem(LAST_URL_KEY)?.trim()
    return saved || 'https://example.com'
  } catch {
    return 'https://example.com'
  }
}

function writeLastUrl(value: string) {
  try {
    const text = value.trim()
    if (text) localStorage.setItem(LAST_URL_KEY, text)
  } catch {
    // ignore
  }
}

export default function App() {
  const [url, setUrl] = useState(readLastUrl)
  const [maxDepth, setMaxDepth] = useState(2)
  const [maxPages, setMaxPages] = useState(80)
  const [concurrency, setConcurrency] = useState(2)
  const [mirrors, setMirrors] = useState<MirrorMeta[]>([])
  const [rootDir, setRootDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CrawlProgress | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [serveUrl, setServeUrl] = useState('')
  const logBoxRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const [list, root] = await Promise.all([window.api.listMirrors(), window.api.mirrorsRoot()])
    setMirrors(list)
    setRootDir(root)
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.api.onCrawlProgress((p) => {
      setProgress(p)
      if (p.log) {
        setLogs((prev) => {
          const next = [
            ...prev,
            { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: nowClock(), text: p.log! }
          ]
          return next.slice(-300)
        })
      }
    })
    return off
  }, [refresh])

  useEffect(() => {
    const el = logBoxRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    setLogs([])
    setServeUrl('')
    writeLastUrl(url)
    setProgress({
      phase: 'start',
      running: true,
      saved: 0,
      maxPages,
      percent: 0,
      message: '准备中…'
    })
    try {
      const meta = await window.api.startCrawl({
        url,
        maxDepth,
        maxPages,
        requestConcurrency: concurrency
      })
      writeLastUrl(url)
      await refresh()
      // 完成后自动用系统浏览器打开本地服务
      if (meta?.id) {
        await openMirror(meta.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function openMirror(id: string) {
    setBusyId(id)
    setError('')
    try {
      const result = await window.api.openMirror(id)
      setServeUrl(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function openCurrentInBrowser() {
    setError('')
    try {
      if (progress?.mirrorId) {
        await openMirror(progress.mirrorId)
        return
      }
      if (progress?.saveDir) {
        setBusyId('current')
        const result = await window.api.openMirrorDir(progress.saveDir)
        setServeUrl(result.url)
        return
      }
      if (mirrors[0]) {
        await openMirror(mirrors[0].id)
        return
      }
      setError('还没有可打开的镜像')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function revealCurrentDir() {
    try {
      if (progress?.saveDir) {
        await window.api.revealPath(progress.saveDir)
        return
      }
      await window.api.revealRoot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function revealMirror(id: string) {
    try {
      await window.api.revealMirror(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function revealRoot() {
    try {
      await window.api.revealRoot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeMirror(id: string) {
    if (!window.confirm('确定删除这个本地镜像？')) return
    await window.api.deleteMirror(id)
    await refresh()
  }

  const percent = progress?.percent ?? 0
  const saveDir = progress?.saveDir || rootDir
  const statusLabel = busy
    ? '运行中'
    : progress?.phase === 'done'
      ? '已完成'
      : progress?.phase === 'error'
        ? '失败'
        : '空闲'

  return (
    <div className="layout">
      <header className="top">
        <div>
          <p className="brand">Web Mirror</p>
          <h1>把网站抓到本地，离线也能打开</h1>
          <p className="lede">
            仅抓取同一域名下的页面与静态资源。请合理设置深度与数量，避免对目标站造成压力。
          </p>
        </div>
        <div className={`status-pill ${busy ? 'is-run' : ''}`} aria-live="polite">
          <span className="dot" />
          {statusLabel}
        </div>
      </header>

      <form className="panel" onSubmit={onSubmit}>
        <label className="field">
          <span>网站地址</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => writeLastUrl(url)}
            placeholder="https://example.com"
            disabled={busy}
            autoFocus
          />
        </label>

        <div className="grid3">
          <label className="field">
            <span>递归深度</span>
            <input
              type="number"
              min={0}
              max={5}
              value={maxDepth}
              disabled={busy}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>最大资源数</span>
            <input
              type="number"
              min={1}
              max={800}
              value={maxPages}
              disabled={busy}
              onChange={(e) => setMaxPages(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>并发</span>
            <input
              type="number"
              min={1}
              max={6}
              value={concurrency}
              disabled={busy}
              onChange={(e) => setConcurrency(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="actions">
          <button type="submit" disabled={busy || !url.trim()}>
            {busy ? '抓取中…' : '开始抓取'}
          </button>
        </div>

        <div className={`runbox ${busy ? 'is-active' : ''}`}>
          <div className="runbox-head">
            <strong>{progress?.message || (busy ? '任务进行中' : '等待开始')}</strong>
            <span>
              {progress ? `${progress.saved}/${progress.maxPages || maxPages}` : `0/${maxPages}`} · {percent}%
            </span>
          </div>

          <div
            className={`bar ${busy ? 'is-busy' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <i style={{ width: `${Math.max(busy && percent < 4 ? 4 : 0, percent)}%` }} />
          </div>

          <div className="pathrow">
            <div>
              <span>保存位置</span>
              <code title={saveDir}>{saveDir || '尚未开始'}</code>
            </div>
            <div className="path-actions">
              <button
                type="button"
                onClick={() => void openCurrentInBrowser()}
                disabled={busy || (!progress?.saveDir && !progress?.mirrorId && mirrors.length === 0)}
              >
                {busyId === 'current' || (busyId && busyId === progress?.mirrorId)
                  ? '打开中…'
                  : '浏览器打开'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void revealCurrentDir()}
                disabled={!progress?.saveDir && !rootDir}
              >
                打开目录
              </button>
            </div>
          </div>

          <div className="logbox" ref={logBoxRef} aria-label="抓取日志">
            {logs.length === 0 ? (
              <p className="log-empty">开始抓取后，这里会滚动显示请求与保存日志。</p>
            ) : (
              logs.map((line) => (
                <div key={line.id} className="log-line">
                  <time>{line.time}</time>
                  <span>{line.text}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {error && <p className="error">{error}</p>}
      </form>

      <section className="list-wrap">
        <div className="list-head">
          <h2>本地镜像</h2>
          <div className="list-actions">
            <button type="button" className="ghost" onClick={() => void revealRoot()} disabled={!rootDir}>
              镜像根目录
            </button>
            <button type="button" className="ghost" onClick={() => void refresh()} disabled={busy}>
              刷新
            </button>
          </div>
        </div>

        {rootDir && (
          <p className="root-hint">
            所有镜像保存在：<code>{rootDir}</code>
          </p>
        )}

        {serveUrl && (
          <p className="serve-hint">
            已在浏览器打开本地服务：<code>{serveUrl}</code>
            （关闭本应用后服务会停止）
          </p>
        )}

        {mirrors.length === 0 ? (
          <p className="empty">还没有镜像。输入网址后点「开始抓取」。</p>
        ) : (
          <ul className="mirrors">
            {mirrors.map((m) => (
              <li key={m.id}>
                <div className="meta">
                  <strong>{m.title}</strong>
                  <code>{m.url}</code>
                  <span>
                    {formatTime(m.createdAt)} · {m.fileCount} 个文件
                  </span>
                  <code className="path">{m.savePath}</code>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => void openMirror(m.id)}
                    disabled={busyId === m.id}
                  >
                    {busyId === m.id ? '打开中…' : '浏览器打开'}
                  </button>
                  <button type="button" className="ghost" onClick={() => void revealMirror(m.id)}>
                    文件夹
                  </button>
                  <button type="button" className="danger" onClick={() => void removeMirror(m.id)}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
