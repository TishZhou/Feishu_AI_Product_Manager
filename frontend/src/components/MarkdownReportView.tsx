import { FileText, ListChecks } from 'lucide-react'
import type { ReactNode } from 'react'

interface MarkdownReportViewProps {
  content: string
  variant?: 'dark' | 'light'
}

function tokens(variant: 'dark' | 'light') {
  return variant === 'dark'
    ? {
        text: 'rgba(203,213,225,0.78)',
        strong: 'rgba(255,255,255,0.88)',
        heading: 'rgba(255,255,255,0.92)',
        subheading: 'rgba(255,255,255,0.82)',
        codeBg: 'rgba(255,255,255,0.08)',
        codeText: 'rgba(191,219,254,0.92)',
        panel: 'rgba(255,255,255,0.03)',
        border: 'rgba(255,255,255,0.08)',
        tableHead: 'rgba(255,255,255,0.06)',
      }
    : {
        text: 'var(--c-ink-700)',
        strong: 'var(--c-ink-900)',
        heading: 'var(--c-ink-900)',
        subheading: 'var(--c-ink-800)',
        codeBg: 'var(--c-ink-100)',
        codeText: 'var(--c-ink-800)',
        panel: 'white',
        border: 'var(--c-line-2)',
        tableHead: 'var(--c-ink-50)',
      }
}

function renderInline(text: string, variant: 'dark' | 'light') {
  const t = tokens(variant)
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded px-1 py-0.5 text-[0.92em]" style={{ background: t.codeBg, color: t.codeText }}>
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} style={{ color: t.strong }}>{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

function MarkdownTable({ rows, variant }: { rows: string[]; variant: 'dark' | 'light' }) {
  const t = tokens(variant)
  const parsed = rows
    .filter(row => !/^\|\s*-+/.test(row))
    .map(row => row.split('|').slice(1, -1).map(cell => cell.trim()))
  if (!parsed.length) return null
  const [head, ...body] = parsed
  return (
    <div className="overflow-auto rounded-xl my-3" style={{ boxShadow: `0 0 0 1px ${t.border}` }}>
      <table className="w-full text-left text-xs">
        <thead style={{ background: t.tableHead }}>
          <tr>
            {head.map((cell, index) => (
              <th key={`${cell}-${index}`} className="px-3 py-2 font-medium whitespace-nowrap" style={{ color: t.subheading }}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ borderTop: `1px solid ${t.border}` }}>
              {row.map((cell, index) => (
                <td key={`${cell}-${index}`} className="px-3 py-2 align-top" style={{ color: t.text }}>
                  {renderInline(cell || '-', variant)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownReportView({ content, variant = 'dark' }: MarkdownReportViewProps) {
  const t = tokens(variant)
  const lines = content.split('\n')
  const nodes: ReactNode[] = []
  let tableRows: string[] = []
  let codeRows: string[] = []
  let inCode = false

  const flushTable = () => {
    if (tableRows.length) {
      nodes.push(<MarkdownTable key={`table-${nodes.length}`} rows={tableRows} variant={variant} />)
      tableRows = []
    }
  }
  const flushCode = () => {
    if (codeRows.length) {
      nodes.push(
        <pre key={`code-${nodes.length}`} className="rounded-xl p-3 text-xs overflow-auto whitespace-pre-wrap my-3"
          style={{ background: variant === 'dark' ? '#0d1117' : 'var(--c-ink-50)', color: t.text, boxShadow: `0 0 0 1px ${t.border}` }}>
          {codeRows.join('\n')}
        </pre>,
      )
      codeRows = []
    }
  }

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      flushTable()
      if (inCode) {
        inCode = false
        flushCode()
      } else {
        inCode = true
      }
      return
    }
    if (inCode) {
      codeRows.push(line)
      return
    }
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      tableRows.push(line.trim())
      return
    }
    flushTable()

    if (line.startsWith('# ')) {
      nodes.push(
        <div key={index} className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl" style={{ background: 'rgba(51,112,255,0.12)', boxShadow: '0 0 0 1px rgba(51,112,255,0.22)' }}>
            <FileText className="w-4 h-4 text-[#8bb7ff]" />
          </div>
          <h1 className="text-lg font-semibold" style={{ color: t.heading }}>{line.slice(2).trim()}</h1>
        </div>,
      )
      return
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={index} className="text-sm font-semibold mt-5 mb-2 flex items-center gap-2" style={{ color: t.subheading }}>
          <ListChecks className="w-3.5 h-3.5 text-[#8bb7ff]" />
          {line.slice(3).trim()}
        </h2>,
      )
      return
    }
    if (line.trim().startsWith('- ')) {
      nodes.push(
        <div key={index} className="flex gap-2 text-xs leading-6" style={{ color: t.text }}>
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'rgba(139,183,255,0.72)' }} />
          <span>{renderInline(line.trim().slice(2), variant)}</span>
        </div>,
      )
      return
    }
    if (!line.trim()) {
      nodes.push(<div key={index} className="h-2" />)
      return
    }
    nodes.push(
      <p key={index} className="text-xs leading-6" style={{ color: t.text }}>
        {renderInline(line, variant)}
      </p>,
    )
  })
  flushTable()
  flushCode()

  return (
    <article className="p-5 max-w-4xl mx-auto">
      <div className="rounded-2xl p-5" style={{ background: t.panel, boxShadow: `0 0 0 1px ${t.border}, inset 0 1px 0 rgba(255,255,255,0.06)` }}>
        {nodes}
      </div>
    </article>
  )
}
