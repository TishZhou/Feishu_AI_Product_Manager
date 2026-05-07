import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Folder, FolderOpen, ChevronRight, X, Check, ArrowLeft, Home, Loader2 } from 'lucide-react'
import { api } from '../lib/api'

interface FsEntry {
  name: string
  path: string
  is_dir: boolean
}

interface FsListResponse {
  path: string
  parent: string | null
  entries: FsEntry[]
}

interface DirectoryBrowserProps {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function DirectoryBrowser({ initialPath, onSelect, onClose }: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? '/home/runner')
  const [data, setData] = useState<FsListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<FsListResponse>('/api/fs/list', { params: { path } })
      setData(res.data)
      setCurrentPath(res.data.path)
    } catch {
      setError('无法读取该目录，请检查路径是否存在或权限是否足够。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(initialPath ?? '/home/runner')
  }, [])

  const navigate = (path: string) => {
    setHistory((h) => [...h, currentPath])
    load(path)
  }

  const goBack = () => {
    const prev = history[history.length - 1]
    if (prev) {
      setHistory((h) => h.slice(0, -1))
      load(prev)
    }
  }

  const goHome = () => {
    setHistory((h) => [...h, currentPath])
    load('/home/runner')
  }

  const breadcrumbs = currentPath.split('/').filter(Boolean)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#0f1729', border: '1px solid rgba(255,255,255,0.12)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-white">选择仓库目录</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
        >
          <button
            onClick={goBack}
            disabled={history.length === 0}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="返回"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={goHome}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="主目录"
          >
            <Home className="w-3.5 h-3.5" />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 ml-1 flex-1 min-w-0">
            <span className="text-slate-500 text-xs">/</span>
            {breadcrumbs.map((seg, i) => {
              const path = '/' + breadcrumbs.slice(0, i + 1).join('/')
              const isLast = i === breadcrumbs.length - 1
              return (
                <div key={path} className="flex items-center gap-1 min-w-0">
                  {!isLast ? (
                    <>
                      <button
                        onClick={() => navigate(path)}
                        className="text-xs text-slate-400 hover:text-blue-300 transition-colors truncate max-w-[80px]"
                      >
                        {seg}
                      </button>
                      <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                    </>
                  ) : (
                    <span className="text-xs text-white font-medium truncate max-w-[120px]">{seg}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Directory list */}
        <div className="overflow-y-auto" style={{ height: '320px' }}>
          {loading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center h-full px-6">
              <p className="text-sm text-red-400 text-center">{error}</p>
            </div>
          )}
          {data && !loading && !error && (
            <div className="py-1">
              {data.parent && (
                <button
                  onClick={() => navigate(data.parent!)}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-white/05 transition-colors group"
                >
                  <Folder className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-sm text-slate-500 group-hover:text-slate-300">..</span>
                </button>
              )}
              {data.entries.length === 0 && (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm text-slate-500">目录为空</p>
                </div>
              )}
              {data.entries.filter(e => e.is_dir).map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigate(entry.path)}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors group"
                  style={{ ':hover': { background: 'rgba(255,255,255,0.05)' } } as any}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-sm text-slate-200 truncate">{entry.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 ml-auto shrink-0 group-hover:text-slate-400 transition-colors" />
                </button>
              ))}
              {data.entries.filter(e => !e.is_dir).map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-3 px-5 py-2 opacity-40 cursor-default"
                >
                  <div className="w-4 h-4 shrink-0" />
                  <span className="text-xs text-slate-500 truncate">{entry.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-4 gap-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-slate-500 mb-0.5">当前路径</p>
            <p className="text-xs text-slate-300 font-mono truncate">{currentPath}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 rounded-xl hover:text-white hover:bg-white/10 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => { onSelect(currentPath); onClose() }}
              className="px-4 py-2 text-sm font-medium text-white rounded-xl flex items-center gap-2 transition-all"
              style={{ background: 'rgba(51,112,255,0.8)', boxShadow: '0 2px 12px rgba(51,112,255,0.35)' }}
            >
              <Check className="w-3.5 h-3.5" />
              选择此目录
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
