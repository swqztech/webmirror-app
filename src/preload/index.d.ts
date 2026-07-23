import { ElectronAPI } from '@electron-toolkit/preload'

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

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      listMirrors: () => Promise<MirrorMeta[]>
      mirrorsRoot: () => Promise<string>
      deleteMirror: (id: string) => Promise<boolean>
      openMirror: (id: string) => Promise<{ url: string; port: number }>
      openMirrorDir: (dir: string) => Promise<{ url: string; port: number }>
      revealMirror: (id: string) => Promise<boolean>
      revealPath: (dir: string) => Promise<boolean>
      revealRoot: () => Promise<string>
      startCrawl: (options: CrawlOptions) => Promise<MirrorMeta>
      isCrawling: () => Promise<boolean>
      onCrawlProgress: (handler: (progress: CrawlProgress) => void) => () => void
    }
  }
}
