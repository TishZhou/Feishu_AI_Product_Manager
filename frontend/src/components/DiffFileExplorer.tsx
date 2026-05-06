import { useMemo, useState } from 'react'
import { FileCode2, GitPullRequestDraft } from 'lucide-react'

export interface DiffFileEntry {
  path: string
  action: string
  diff: string
  additions: number
  deletions: number
  generated_content?: string
}

interface DiffFileExplorerProps {
  text?: string
  files?: DiffFileEntry[]
  selectedPath?: string | null
  onSelectPath?: (path: string) => void
  showFileMode?: boolean
}

function parsePatchFiles(text: string): DiffFileEntry[] {
  const entries: DiffFileEntry[] = []
  let current: { oldPath: string; newPath: string; lines: string[] } | null = null

  const flush = () => {
    if (!current) return
    const path = normalizePatchPath(current.newPath !== '/dev/null' ? current.newPath : current.oldPath)
    if (!path) {
      current = null
      return
    }
    const diff = current.lines.join('')
    const additions = current.lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length
    const deletions = current.lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length
    const action = current.oldPath === '/dev/null'
      ? 'create'
      : current.newPath === '/dev/null'
        ? 'delete'
        : 'modify'
    entries.push({ path, action, diff, additions, deletions })
    current = null
  }

  const lines = text.split('\n')
  lines.forEach((line, index) => {
    const raw = line + (index === lines.length - 1 ? '' : '\n')
    if (line.startsWith('diff --git ')) {
      flush()
      const parts = line.trim().split(/\s+/)
      current = { oldPath: parts[2] || '', newPath: parts[3] || '', lines: [raw] }
      return
    }
    if (!current) return
    current.lines.push(raw)
    if (line.startsWith('--- ')) current.oldPath = line.slice(4).trim()
    if (line.startsWith('+++ ')) current.newPath = line.slice(4).trim()
  })
  flush()
  return entries
}

function normalizePatchPath(path: string) {
  if (!path || path === '/dev/null') return ''
  return path.replace(/^"[ab]\//, '').replace(/"$/, '').replace(/^[ab]\//, '')
}

function DiffViewer({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="text-xs font-mono leading-5 min-h-full py-3"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
      {lines.map((line, idx) => {
        const isAdded = line.startsWith('+') && !line.startsWith('+++')
        const isDeleted = line.startsWith('-') && !line.startsWith('---')
        const isHunk = line.startsWith('@@')
        const isHeader = line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++')
        const bg = isAdded
          ? 'rgba(16,185,129,0.15)'
          : isDeleted
            ? 'rgba(239,68,68,0.15)'
            : isHunk
              ? 'rgba(51,112,255,0.14)'
              : isHeader
                ? 'rgba(255,255,255,0.045)'
                : 'transparent'
        const color = isAdded
          ? 'rgba(167,243,208,0.95)'
          : isDeleted
            ? 'rgba(254,202,202,0.95)'
            : isHunk
              ? 'rgba(191,219,254,0.95)'
              : isHeader
                ? 'rgba(226,232,240,0.80)'
                : 'rgba(203,213,225,0.82)'
        const borderColor = isAdded
          ? 'rgba(16,185,129,0.55)'
          : isDeleted
            ? 'rgba(239,68,68,0.55)'
            : 'transparent'
        return (
          <div key={idx} className="flex min-w-max"
            style={{ background: bg, color, borderLeft: `2px solid ${borderColor}` }}>
            <span className="select-none text-right shrink-0 px-3"
              style={{ width: 56, color: 'rgba(148,163,184,0.45)' }}>
              {idx + 1}
            </span>
            <span className="whitespace-pre-wrap break-words pr-4 flex-1">{line || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

export function DiffFileExplorer({
  text = '',
  files,
  selectedPath,
  onSelectPath,
  showFileMode = true,
}: DiffFileExplorerProps) {
  const parsedFiles = useMemo(() => files ?? parsePatchFiles(text), [files, text])
  const [localSelectedPath, setLocalSelectedPath] = useState('')
  const [viewMode, setViewMode] = useState<'diff' | 'file'>('diff')
  const activePath = parsedFiles.some(file => file.path === selectedPath)
    ? selectedPath
    : parsedFiles.some(file => file.path === localSelectedPath)
      ? localSelectedPath
      : parsedFiles[0]?.path ?? ''
  const selected = parsedFiles.find(file => file.path === activePath) ?? null
  const additions = parsedFiles.reduce((sum, file) => sum + file.additions, 0)
  const deletions = parsedFiles.reduce((sum, file) => sum + file.deletions, 0)
  const canShowFile = showFileMode && !!selected?.generated_content

  const selectFile = (path: string) => {
    setLocalSelectedPath(path)
    onSelectPath?.(path)
  }

  if (parsedFiles.length === 0) {
    return (
      <pre className="text-xs font-mono text-slate-300 p-5 m-0 whitespace-pre-wrap break-words leading-5 min-h-full"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
        {text || '暂无代码变更'}
      </pre>
    )
  }

  return (
    <div className="h-full min-h-full grid grid-cols-[290px_1fr] overflow-hidden">
      <aside className="min-w-0 flex flex-col" style={{ background: '#111720', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.38)' }}>变更文件</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.72)' }}>{parsedFiles.length} 个文件</p>
            </div>
            <div className="text-right font-mono text-[11px]">
              <span className="text-emerald-300">+{additions}</span>
              <span className="text-slate-600 mx-1">/</span>
              <span className="text-red-300">-{deletions}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {parsedFiles.map(file => {
            const selectedFile = file.path === selected?.path
            return (
              <button
                type="button"
                key={file.path}
                onClick={() => selectFile(file.path)}
                className="w-full rounded-xl px-3 py-2.5 text-left transition-colors"
                style={{
                  background: selectedFile ? 'rgba(51,112,255,0.14)' : 'transparent',
                  border: `1px solid ${selectedFile ? 'rgba(51,112,255,0.32)' : 'rgba(255,255,255,0.055)'}`,
                }}
              >
                <div className="flex items-start gap-2">
                  <FileCode2 className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: selectedFile ? 'rgba(147,197,253,0.85)' : 'rgba(255,255,255,0.32)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-mono truncate" style={{ color: selectedFile ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.62)' }}>
                      {file.path}
                    </p>
                    <p className="text-[9px] uppercase mt-1" style={{ color: 'rgba(255,255,255,0.30)' }}>{actionLabel(file.action)}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-2 text-[10px] font-mono">
                  <span className="text-emerald-300">+{file.additions}</span>
                  <span className="text-red-300">-{file.deletions}</span>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="min-w-0 flex flex-col overflow-hidden" style={{ background: '#0d1117' }}>
        <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-2"
          style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2 min-w-0 text-xs text-slate-400">
            <GitPullRequestDraft className="w-4 h-4 shrink-0" />
            <span className="uppercase shrink-0">{actionLabel(selected?.action || 'change')}</span>
            <span className="text-slate-600">·</span>
            <span className="truncate text-slate-200">{selected?.path}</span>
            {selected && <span className="text-emerald-400 shrink-0">+{selected.additions}</span>}
            {selected && <span className="text-red-400 shrink-0">-{selected.deletions}</span>}
          </div>
          {canShowFile && (
            <div className="flex rounded-lg overflow-hidden border border-white/10 shrink-0">
              {(['diff', 'file'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-xs ${viewMode === mode ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {mode === 'diff' ? '差异' : '完整文件'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {selected && canShowFile && viewMode === 'file' ? (
            <pre
              className="text-xs font-mono text-slate-300 p-4 m-0 whitespace-pre-wrap break-words leading-5 min-h-full"
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
            >
              {selected.generated_content || '没有生成后的完整文件快照'}
            </pre>
          ) : (
            <DiffViewer text={selected?.diff || text || '暂无代码变更'} />
          )}
        </div>
      </section>
    </div>
  )
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    create: '新增',
    modify: '修改',
    delete: '删除',
    change: '变更',
  }
  return labels[action] ?? action
}
