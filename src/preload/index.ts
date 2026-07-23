import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

const api = {
  listMirrors: (): Promise<MirrorMeta[]> => ipcRenderer.invoke('mirrors:list'),
  mirrorsRoot: (): Promise<string> => ipcRenderer.invoke('mirrors:root'),
  deleteMirror: (id: string): Promise<boolean> => ipcRenderer.invoke('mirrors:delete', id),
  openMirror: (id: string): Promise<{ url: string; port: number }> =>
    ipcRenderer.invoke('mirrors:open', id),
  openMirrorDir: (dir: string): Promise<{ url: string; port: number }> =>
    ipcRenderer.invoke('mirrors:openDir', dir),
  revealMirror: (id: string): Promise<boolean> => ipcRenderer.invoke('mirrors:reveal', id),
  revealPath: (dir: string): Promise<boolean> => ipcRenderer.invoke('mirrors:revealPath', dir),
  revealRoot: (): Promise<string> => ipcRenderer.invoke('mirrors:revealRoot'),
  startCrawl: (options: CrawlOptions): Promise<MirrorMeta> =>
    ipcRenderer.invoke('crawl:start', options),
  isCrawling: (): Promise<boolean> => ipcRenderer.invoke('crawl:isRunning'),
  onCrawlProgress: (handler: (progress: CrawlProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: CrawlProgress) => {
      handler(progress)
    }
    ipcRenderer.on('crawl:progress', listener)
    return () => ipcRenderer.removeListener('crawl:progress', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
