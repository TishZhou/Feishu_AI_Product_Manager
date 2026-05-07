import { useMemo } from 'react'
import { FileDiff, Plus, Minus } from 'lucide-react'
import { MarkdownReportView } from './MarkdownReportView'
import { TestReportView } from './TestReportView'
import { isJsonArtifact, isMarkdownArtifact, isPatchOrCodeArtifact } from '../lib/stageArtifacts'

interface ArtifactContentViewProps {
  filename: string
  content: string
  variant?: 'dark' | 'light'
  compact?: boolean
}

function isPatchFilename(filename: string) {
  return filename.endsWith('.patch') || filename.endsWith('.diff')
}

export function ArtifactContentView({ filename, content, variant = 'dark', compact = false }: ArtifactContentViewProps) {
  const trimmed = content.trim()

  if (filename === 'test_report.json') {
    return <TestReportView content={content} variant={variant} compact={compact} />
  }

  if (filename === 'review_report.json') {
    return <ReviewReportView content={content} variant={variant} />
  }

  if (isPatchFilename(filename) || trimmed.startsWith('diff --git ')) {
    return <PatchDiffView content={content} variant={variant} />
  }

  if (isMarkdownArtifact(filename)) {
    return <MarkdownReportView content={content} variant={variant} />
  }

  if (isJsonArtifact(filename)) {
    return <JsonDocumentView content={content} variant={variant} />
  }

  if (isPatchOrCodeArtifact(filename)) {
    return <CodeDocumentView content={content} variant={variant} />
  }

  if (trimmed.startsWith('#') || trimmed.includes('\n## ')) {
    return <MarkdownReportView content={content} variant={variant} />
  }

  return <PlainDocumentView content={content} variant={variant} />
}

function ReviewReportView({ content, variant }: { content: string; variant: 'dark' | 'light' }) {
  let parsed: Record<string, unknown> | null = null
  try {
    const value = JSON.parse(content)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>
    }
  } catch {
    return <CodeDocumentView content={content} variant={variant} />
  }
  if (!parsed) {
    return <JsonDocumentView content={content} variant={variant} />
  }

  const reportMarkdown = typeof parsed.report_markdown === 'string' ? parsed.report_markdown.trim() : ''
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'report_markdown') continue
    rest[key] = value
  }
  const hasRest = Object.keys(rest).length > 0

  return (
    <div>
      {reportMarkdown && <MarkdownReportView content={reportMarkdown} variant={variant} />}
      {hasRest && (
        <div className="p-5 pt-0">
          <div className="rounded-2xl p-5" style={{
            background: variant === 'dark' ? 'rgba(255,255,255,0.03)' : 'white',
            boxShadow: `0 0 0 1px ${variant === 'dark' ? 'rgba(255,255,255,0.08)' : 'var(--c-line-2)'}`,
          }}>
            <JsonNode value={rest} variant={variant} depth={0} />
          </div>
        </div>
      )}
      {!reportMarkdown && !hasRest && <PlainDocumentView content={content} variant={variant} />}
    </div>
  )
}

function JsonDocumentView({ content, variant }: { content: string; variant: 'dark' | 'light' }) {
  try {
    const parsed = JSON.parse(content)
    return (
      <div className="p-5">
        <div className="rounded-2xl p-5" style={{
          background: variant === 'dark' ? 'rgba(255,255,255,0.03)' : 'white',
          boxShadow: `0 0 0 1px ${variant === 'dark' ? 'rgba(255,255,255,0.08)' : 'var(--c-line-2)'}`,
        }}>
          <JsonNode value={parsed} variant={variant} depth={0} />
        </div>
      </div>
    )
  } catch {
    return <CodeDocumentView content={content} variant={variant} />
  }
}

function JsonNode({ value, variant, depth }: { value: unknown; variant: 'dark' | 'light'; depth: number }) {
  const text = variant === 'dark' ? 'rgba(203,213,225,0.82)' : 'var(--c-ink-700)'
  const heading = variant === 'dark' ? 'rgba(255,255,255,0.88)' : 'var(--c-ink-900)'
  const muted = variant === 'dark' ? 'rgba(148,163,184,0.70)' : 'var(--c-ink-500)'
  const border = variant === 'dark' ? 'rgba(255,255,255,0.08)' : 'var(--c-line)'

  if (Array.isArray(value)) {
    return (
      <ul style={{ margin: depth ? '6px 0 10px' : 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        {value.map((item, index) => (
          <li key={index} style={{ color: text, fontSize: 13, lineHeight: 1.65 }}>
            {typeof item === 'object' && item !== null
              ? <JsonNode value={item} variant={variant} depth={depth + 1} />
              : String(item)}
          </li>
        ))}
      </ul>
    )
  }

  if (value && typeof value === 'object') {
    return (
      <div style={{ display: 'grid', gap: depth === 0 ? 14 : 8 }}>
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <section key={key} style={{
            paddingTop: depth === 0 ? 0 : 6,
            borderTop: depth === 0 ? 'none' : `1px solid ${border}`,
          }}>
            <div style={{
              fontSize: depth === 0 ? 13 : 12,
              fontWeight: 650,
              color: heading,
              marginBottom: 5,
            }}>
              {formatKey(key)}
            </div>
            {typeof item === 'object' && item !== null ? (
              <JsonNode value={item} variant={variant} depth={depth + 1} />
            ) : (
              <p style={{ margin: 0, color: item == null || item === '' ? muted : text, fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {item == null || item === '' ? '未指定' : String(item)}
              </p>
            )}
          </section>
        ))}
      </div>
    )
  }

  return <span style={{ color: text }}>{String(value)}</span>
}

function formatKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function CodeDocumentView({ content, variant }: { content: string; variant: 'dark' | 'light' }) {
  return (
    <pre
      className="text-xs font-mono p-5 m-0 whitespace-pre-wrap break-words leading-5 min-h-full"
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: variant === 'dark' ? 'rgba(203,213,225,0.86)' : 'var(--c-ink-800)',
        background: variant === 'dark' ? '#0d1117' : 'var(--c-ink-50)',
      }}
    >
      {content}
    </pre>
  )
}

// ─── Patch diff renderer ──────────────────────────────────────────────────────

interface DiffFile {
  path: string
  oldPath: string
  isNew: boolean
  isDeleted: boolean
  added: number
  removed: number
  hunks: DiffHunk[]
}
interface DiffHunk {
  header: string
  lines: DiffLine[]
}
interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'meta'
  text: string
  // line numbers in old / new file (null for the side that doesn't have this line)
  oldNo: number | null
  newNo: number | null
}

function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  const lines = text.split('\n')
  let current: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk)
    hunk = null
  }
  const flushFile = () => {
    flushHunk()
    if (current) files.push(current)
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      flushFile()
      // diff --git a/path b/path
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
      const path = match?.[2] ?? line.replace('diff --git ', '')
      const oldPath = match?.[1] ?? path
      current = { path, oldPath, isNew: false, isDeleted: false, added: 0, removed: 0, hunks: [] }
      continue
    }
    if (!current) {
      // Diff fragment without a `diff --git` header — synthesise a placeholder file.
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) {
        current = { path: '(unnamed)', oldPath: '(unnamed)', isNew: false, isDeleted: false, added: 0, removed: 0, hunks: [] }
      } else {
        continue
      }
    }
    if (line.startsWith('new file mode')) { current.isNew = true; continue }
    if (line.startsWith('deleted file mode')) { current.isDeleted = true; continue }
    if (line.startsWith('--- ')) {
      const p = line.slice(4).trim()
      if (p === '/dev/null') current.isNew = true
      else current.oldPath = p.replace(/^a\//, '')
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      if (p === '/dev/null') current.isDeleted = true
      else current.path = p.replace(/^b\//, '')
      continue
    }
    if (line.startsWith('@@')) {
      flushHunk()
      // @@ -oldStart,oldCount +newStart,newCount @@ context
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLine = m ? parseInt(m[1], 10) : 0
      newLine = m ? parseInt(m[2], 10) : 0
      hunk = { header: line, lines: [] }
      continue
    }
    if (!hunk) {
      // Skip "index ...", "Binary files ..." etc.
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++ ')) {
      hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newLine })
      newLine += 1
      current.added += 1
    } else if (line.startsWith('-') && !line.startsWith('--- ')) {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldLine, newNo: null })
      oldLine += 1
      current.removed += 1
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      hunk.lines.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
    } else {
      // context line (starts with space) or empty trailing
      const text = line.startsWith(' ') ? line.slice(1) : line
      hunk.lines.push({ kind: 'ctx', text, oldNo: oldLine, newNo: newLine })
      oldLine += 1
      newLine += 1
    }
  }
  flushFile()
  return files
}

function PatchDiffView({ content, variant }: { content: string; variant: 'dark' | 'light' }) {
  const files = useMemo(() => parseUnifiedDiff(content), [content])

  if (files.length === 0) {
    return <CodeDocumentView content={content} variant={variant} />
  }

  const dark = variant === 'dark'
  const palette = dark
    ? {
        cardBg: 'rgba(255,255,255,0.03)', cardBorder: 'rgba(255,255,255,0.08)',
        headerBg: 'rgba(255,255,255,0.05)',
        text: 'rgba(226,232,240,0.92)', muted: 'rgba(148,163,184,0.70)',
        codeBg: '#0d1117', codeText: 'rgba(226,232,240,0.92)',
        addBg: 'rgba(34,197,94,0.16)', addBorder: 'rgba(34,197,94,0.40)', addText: 'rgba(187,247,208,0.95)',
        delBg: 'rgba(239,68,68,0.18)', delBorder: 'rgba(239,68,68,0.45)', delText: 'rgba(254,202,202,0.95)',
        hunkBg: 'rgba(96,165,250,0.10)', hunkText: 'rgba(147,197,253,0.85)',
        gutter: 'rgba(148,163,184,0.55)',
        addStat: 'rgba(120,255,190,0.85)', delStat: 'rgba(255,180,175,0.86)',
      }
    : {
        cardBg: 'white', cardBorder: 'var(--c-line-2)',
        headerBg: 'var(--c-ink-50)',
        text: 'var(--c-ink-900)', muted: 'var(--c-ink-500)',
        codeBg: 'white', codeText: 'var(--c-ink-800)',
        addBg: '#ECFDF5', addBorder: '#A7F3D0', addText: '#065F46',
        delBg: '#FEF2F2', delBorder: '#FECACA', delText: '#7F1D1D',
        hunkBg: '#EFF6FF', hunkText: '#1D4ED8',
        gutter: 'var(--c-ink-400)',
        addStat: '#047857', delStat: '#B91C1C',
      }

  const totalAdd = files.reduce((sum, f) => sum + f.added, 0)
  const totalDel = files.reduce((sum, f) => sum + f.removed, 0)

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 16px', borderRadius: 12,
        background: palette.cardBg, boxShadow: `0 0 0 1px ${palette.cardBorder}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: palette.text }}>
          <FileDiff size={15} strokeWidth={1.8} />
          <span className="display" style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em' }}>
            {files.length} 个文件变更
          </span>
        </div>
        <div className="mono" style={{ display: 'flex', gap: 12, fontSize: 12, fontWeight: 600 }}>
          <span style={{ color: palette.addStat }}>+{totalAdd}</span>
          <span style={{ color: palette.delStat }}>−{totalDel}</span>
        </div>
      </div>

      {/* File cards */}
      {files.map((file, fi) => {
        const tag =
          file.isNew ? { label: '新增', bg: palette.addBg, fg: palette.addStat, border: palette.addBorder }
          : file.isDeleted ? { label: '删除', bg: palette.delBg, fg: palette.delStat, border: palette.delBorder }
          : { label: '修改', bg: palette.hunkBg, fg: palette.hunkText, border: palette.cardBorder }

        return (
          <div key={`${file.path}-${fi}`} style={{
            borderRadius: 12, overflow: 'hidden',
            background: palette.cardBg, boxShadow: `0 0 0 1px ${palette.cardBorder}`,
          }}>
            {/* File header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '10px 14px',
              background: palette.headerBg,
              borderBottom: `1px solid ${palette.cardBorder}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 6,
                  background: tag.bg, color: tag.fg,
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  border: `1px solid ${tag.border}`,
                }}>
                  {tag.label}
                </span>
                <span className="mono" style={{
                  fontSize: 12, color: palette.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}>
                  {file.path}
                </span>
                {file.isNew === false && file.oldPath && file.oldPath !== file.path && !file.isDeleted && (
                  <span className="mono" style={{ fontSize: 10.5, color: palette.muted }}>
                    ← {file.oldPath}
                  </span>
                )}
              </div>
              <div className="mono" style={{ display: 'flex', gap: 10, fontSize: 11, fontWeight: 600 }}>
                <span style={{ color: palette.addStat, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <Plus size={11} strokeWidth={2.4} />{file.added}
                </span>
                <span style={{ color: palette.delStat, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <Minus size={11} strokeWidth={2.4} />{file.removed}
                </span>
              </div>
            </div>

            {/* Hunks */}
            <div style={{ background: palette.codeBg }}>
              {file.hunks.length === 0 ? (
                <div style={{ padding: '14px 16px', fontSize: 12, color: palette.muted }}>
                  无可显示的差异块（可能是二进制文件或纯重命名）
                </div>
              ) : file.hunks.map((h, hi) => (
                <div key={`${hi}-${h.header}`}>
                  <div className="mono" style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 500,
                    background: palette.hunkBg, color: palette.hunkText,
                    borderTop: hi > 0 ? `1px solid ${palette.cardBorder}` : 'none',
                  }}>
                    {h.header}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="mono" style={{
                      width: '100%', borderCollapse: 'collapse',
                      fontSize: 12, lineHeight: 1.55, color: palette.codeText,
                    }}>
                      <tbody>
                        {h.lines.map((line, li) => {
                          const bg = line.kind === 'add' ? palette.addBg
                            : line.kind === 'del' ? palette.delBg : 'transparent'
                          const fg = line.kind === 'add' ? palette.addText
                            : line.kind === 'del' ? palette.delText : palette.codeText
                          const sigil = line.kind === 'add' ? '+'
                            : line.kind === 'del' ? '-'
                            : line.kind === 'meta' ? '\\' : ' '
                          return (
                            <tr key={li} style={{ background: bg }}>
                              <td style={{
                                userSelect: 'none', textAlign: 'right',
                                padding: '0 8px', width: 44,
                                color: palette.gutter, fontSize: 10.5,
                                borderRight: `1px solid ${palette.cardBorder}`,
                                verticalAlign: 'top',
                              }}>
                                {line.oldNo ?? ''}
                              </td>
                              <td style={{
                                userSelect: 'none', textAlign: 'right',
                                padding: '0 8px', width: 44,
                                color: palette.gutter, fontSize: 10.5,
                                borderRight: `1px solid ${palette.cardBorder}`,
                                verticalAlign: 'top',
                              }}>
                                {line.newNo ?? ''}
                              </td>
                              <td style={{
                                userSelect: 'none', textAlign: 'center',
                                padding: '0 6px', width: 18,
                                color: fg, fontWeight: 600,
                                verticalAlign: 'top',
                              }}>
                                {sigil}
                              </td>
                              <td style={{
                                padding: '0 12px 0 4px',
                                color: fg, whiteSpace: 'pre',
                                verticalAlign: 'top',
                              }}>
                                {line.text || ' '}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PlainDocumentView({ content, variant }: { content: string; variant: 'dark' | 'light' }) {
  return (
    <div className="p-5 text-sm leading-7 whitespace-pre-wrap" style={{
      color: variant === 'dark' ? 'rgba(203,213,225,0.82)' : 'var(--c-ink-700)',
    }}>
      {content}
    </div>
  )
}
