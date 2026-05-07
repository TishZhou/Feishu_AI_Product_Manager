import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode2,
  ListChecks,
  PlayCircle,
  Terminal,
  XCircle,
} from 'lucide-react'
import type { CommandRunResult, GeneratedTestFile, TestCaseResult, TestReport, TestRunResult } from '../types/api'
import { parseTestReport } from '../lib/testReport'

interface TestReportViewProps {
  content: string
  variant?: 'dark' | 'light'
  compact?: boolean
}

interface NormalizedReport {
  report: TestReport
  total: number
  passed: number
  failed: number
  skipped: number
  exitCode: number
  success: boolean
  tests: TestCaseResult[]
  files: GeneratedTestFile[]
  runs: TestRunResult[]
  commands: CommandRunResult[]
}

function normalizeReport(content: string): NormalizedReport | null {
  const report = parseTestReport(content)
  if (!report) return null
  const runs = Array.isArray(report.runner_validation?.runs) ? report.runner_validation.runs : []
  const commands = Array.isArray(report.runner_validation?.commands) ? report.runner_validation.commands : []
  const firstCounts = runs[0]?.counts ?? {}
  const passed = asNumber(report.passed, firstCounts.passed)
  const failed = asNumber(report.failed, firstCounts.failed, firstCounts.errors)
  const skipped = asNumber(report.skipped, firstCounts.skipped)
  const total = asNumber(report.total, passed + failed + skipped)
  const exitCode = asNumber(report.exit_code, runs.find((run) => run.exit_code !== undefined)?.exit_code, 0)
  const tests = Array.isArray(report.test_cases) ? report.test_cases : []
  const files = Array.isArray(report.generated_test_files) ? report.generated_test_files : []
  return {
    report,
    total,
    passed,
    failed,
    skipped,
    exitCode,
    success: exitCode === 0 && failed === 0,
    tests,
    files,
    runs,
    commands,
  }
}

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return 0
}

// Token tables for both themes; the light palette mirrors OverviewView/DetailView.
type Variant = 'dark' | 'light'
function tokens(variant: Variant) {
  if (variant === 'dark') {
    return {
      panelBg: 'rgba(255,255,255,0.03)',
      panelShadow: '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
      cardBg: 'rgba(255,255,255,0.025)',
      cardBorder: 'rgba(255,255,255,0.07)',
      headBg: 'rgba(255,255,255,0.035)',
      heading: 'rgba(255,255,255,0.86)',
      text: 'rgba(255,255,255,0.70)',
      muted: 'rgba(255,255,255,0.42)',
      mutedSoft: 'rgba(255,255,255,0.34)',
      codeBg: '#0d1117',
      codeText: 'rgba(203,213,225,0.86)',
      gutter: 'rgba(148,163,184,0.42)',
      termBg: 'rgba(0,0,0,0.30)',
      termText: 'rgba(203,213,225,0.82)',
      ok:    { fg: 'rgba(120,255,190,0.78)', bg: 'rgba(80,220,155,0.18)',   border: 'rgba(80,220,155,0.30)' },
      bad:   { fg: 'rgba(255,180,175,0.82)', bg: 'rgba(255,120,112,0.16)',  border: 'rgba(255,120,112,0.32)' },
      warn:  { fg: 'rgba(255,220,150,0.78)', bg: 'rgba(255,205,120,0.14)',  border: 'rgba(255,205,120,0.30)' },
      neut:  { fg: 'rgba(226,232,240,0.78)', bg: 'rgba(255,255,255,0.05)',  border: 'rgba(255,255,255,0.10)' },
      info:  { fg: 'rgba(191,219,254,0.86)', bg: 'rgba(96,165,250,0.16)',   border: 'rgba(96,165,250,0.34)' },
      barBg: 'rgba(255,255,255,0.08)',
    }
  }
  return {
    panelBg: 'white',
    panelShadow: '0 0 0 1px var(--c-line-2), inset 0 1px 0 rgba(255,255,255,0.4)',
    cardBg: 'white',
    cardBorder: 'var(--c-line-2)',
    headBg: 'var(--c-ink-50)',
    heading: 'var(--c-ink-900)',
    text: 'var(--c-ink-800)',
    muted: 'var(--c-ink-500)',
    mutedSoft: 'var(--c-ink-400)',
    codeBg: '#0F172A',
    codeText: 'rgba(226,232,240,0.92)',
    gutter: 'rgba(148,163,184,0.7)',
    termBg: '#0F172A',
    termText: 'rgba(226,232,240,0.92)',
    ok:    { fg: '#047857', bg: '#ECFDF5', border: '#A7F3D0' },
    bad:   { fg: '#B91C1C', bg: '#FEF2F2', border: '#FECACA' },
    warn:  { fg: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
    neut:  { fg: 'var(--c-ink-700)', bg: 'var(--c-ink-50)', border: 'var(--c-line-2)' },
    info:  { fg: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
    barBg: 'var(--c-ink-100)',
  }
}

type Tone = 'ok' | 'bad' | 'muted' | 'warn'

function StatPill({ label, value, tone, variant }: { label: string; value: number; tone: Tone; variant: Variant }) {
  const t = tokens(variant)
  const palette = tone === 'ok' ? t.ok : tone === 'bad' ? t.bad : tone === 'warn' ? t.warn : t.neut
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
      style={{
        background: palette.bg,
        boxShadow: `0 0 0 1px ${palette.border}`,
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 600, color: palette.fg, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: palette.fg }}>{value}</span>
    </div>
  )
}

function ResultBar({ passed, failed, skipped, total, variant }: { passed: number; failed: number; skipped: number; total: number; variant: Variant }) {
  const t = tokens(variant)
  const denominator = Math.max(total, passed + failed + skipped, 1)
  const segments = [
    { key: 'passed', value: passed, color: t.ok.fg },
    { key: 'failed', value: failed, color: t.bad.fg },
    { key: 'skipped', value: skipped, color: t.warn.fg },
  ]
  return (
    <div className="h-2 rounded-full overflow-hidden flex" style={{ background: t.barBg }}>
      {segments.map((segment) => (
        <div
          key={segment.key}
          style={{
            width: `${Math.max((segment.value / denominator) * 100, segment.value ? 3 : 0)}%`,
            background: segment.color,
          }}
        />
      ))}
    </div>
  )
}

function CodeBlock({ content, compact, variant }: { content: string; compact?: boolean; variant: Variant }) {
  const t = tokens(variant)
  const lines = content.split('\n')
  return (
    <div
      className="overflow-auto rounded-xl"
      style={{
        maxHeight: compact ? 220 : 420,
        background: t.codeBg,
        boxShadow: `0 0 0 1px ${variant === 'dark' ? 'rgba(255,255,255,0.08)' : 'var(--c-line)'}`,
      }}
    >
      <div className="text-xs font-mono leading-5 py-3 min-w-max">
        {lines.map((line, index) => (
          <div key={`${index}-${line}`} className="flex">
            <span
              className="select-none shrink-0 px-3 text-right"
              style={{ width: 48, color: t.gutter }}
            >
              {index + 1}
            </span>
            <span className="pr-4 whitespace-pre" style={{ color: t.codeText }}>
              {line || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TerminalBlock({ title, text, compact, variant }: { title: string; text: string; compact?: boolean; variant: Variant }) {
  if (!text.trim()) return null
  const t = tokens(variant)
  const display = compact && text.length > 1600 ? `${text.slice(-1600)}\n...` : text
  return (
    <div className="rounded-xl overflow-hidden" style={{ boxShadow: `0 0 0 1px ${variant === 'dark' ? 'rgba(255,255,255,0.08)' : 'var(--c-line)'}` }}>
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: t.headBg, color: t.muted }}
      >
        <Terminal className="w-3.5 h-3.5" />
        <span className="text-[10px] font-mono uppercase tracking-wider">{title}</span>
      </div>
      <pre
        className="m-0 overflow-auto p-3 text-[11px] leading-5 whitespace-pre-wrap"
        style={{
          maxHeight: compact ? 180 : 320,
          background: t.termBg,
          color: t.termText,
        }}
      >
        {display}
      </pre>
    </div>
  )
}

function TestCaseRow({ test, variant }: { test: TestCaseResult; variant: Variant }) {
  const t = tokens(variant)
  const status = test.status ?? 'unknown'
  const ok = status === 'passed'
  const failed = status === 'failed'
  const Icon = ok ? CheckCircle2 : failed ? XCircle : AlertTriangle
  const palette = ok ? t.ok : failed ? t.bad : t.warn
  const border = variant === 'dark' ? 'rgba(255,255,255,0.06)' : 'var(--c-line)'
  return (
    <div className="flex items-start gap-2 py-2 px-1" style={{ borderTop: `1px solid ${border}` }}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: palette.fg }} />
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-mono truncate" style={{ color: t.heading }}>
          {test.name || test.id || '未命名测试'}
        </p>
        {test.message && (
          <p className="text-[10.5px] mt-1 leading-relaxed" style={{ color: t.mutedSoft }}>
            {test.message}
          </p>
        )}
      </div>
      <span className="text-[9.5px] font-mono shrink-0 uppercase" style={{ color: palette.fg, fontWeight: 600 }}>
        {status === 'passed' ? '通过' : status === 'failed' ? '失败' : status === 'skipped' ? '跳过' : status}
      </span>
    </div>
  )
}

export function TestReportView({ content, variant = 'dark', compact = false }: TestReportViewProps) {
  const normalized = normalizeReport(content)
  if (!normalized) return null

  const t = tokens(variant)
  const { report, total, passed, failed, skipped, exitCode, success, tests, files, runs, commands } = normalized
  const primaryRun = runs[0]
  const headerPalette = success ? t.ok : t.bad
  const StatusIcon = success ? CheckCircle2 : XCircle
  const visibleFiles = compact ? files.slice(0, 1) : files
  const visibleRuns = compact ? runs.slice(0, 1) : runs

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5 p-5'}>
      {/* ─── Status hero card ─── */}
      <div
        className="rounded-2xl p-4"
        style={{
          background: t.panelBg,
          boxShadow: t.panelShadow,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="p-2 rounded-xl shrink-0"
              style={{
                background: headerPalette.bg,
                boxShadow: `0 0 0 1px ${headerPalette.border}`,
              }}
            >
              <StatusIcon className="w-4 h-4" style={{ color: headerPalette.fg }} />
            </div>
            <div className="min-w-0">
              <p className="display" style={{ fontSize: 14, fontWeight: 700, color: t.heading, margin: 0, letterSpacing: '-0.01em' }}>
                {success ? '测试通过' : '测试未通过'}
              </p>
              <p className="text-[11px] mt-1 font-mono truncate" style={{ color: t.muted }}>
                {report.test_command || primaryRun?.test_path || 'pytest'}
              </p>
              {report.summary && (
                <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: t.text }}>
                  {report.summary}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: t.muted }}>
            <span className="flex items-center gap-1.5">
              <PlayCircle className="w-3.5 h-3.5" />
              exit {exitCode}
            </span>
            {primaryRun?.duration_seconds !== undefined && (
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {primaryRun.duration_seconds}s
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-4">
          <StatPill label="总数" value={total} tone="muted" variant={variant} />
          <StatPill label="通过" value={passed} tone="ok" variant={variant} />
          <StatPill label="失败" value={failed} tone={failed ? 'bad' : 'muted'} variant={variant} />
          <StatPill label="跳过" value={skipped} tone={skipped ? 'warn' : 'muted'} variant={variant} />
        </div>
        <div className="mt-4">
          <ResultBar passed={passed} failed={failed} skipped={skipped} total={total} variant={variant} />
        </div>
      </div>

      {/* ─── Test cases ─── */}
      {tests.length > 0 && !compact && (
        <div>
          <div className="flex items-center gap-2 mb-2" style={{ color: t.muted }}>
            <ListChecks className="w-3.5 h-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">测试用例</span>
          </div>
          <div className="rounded-xl px-3" style={{ background: t.cardBg, boxShadow: `0 0 0 1px ${t.cardBorder}` }}>
            {tests.map((test, index) => <TestCaseRow key={`${test.id || test.name || 'case'}-${index}`} test={test} variant={variant} />)}
          </div>
        </div>
      )}

      {/* ─── Generated test code ─── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2" style={{ color: t.muted }}>
          <FileCode2 className="w-3.5 h-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">生成的测试代码</span>
        </div>
        {visibleFiles.length > 0 ? (
          visibleFiles.map((file) => (
            <div key={file.path} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px] font-mono truncate" style={{ color: t.text }}>
                  {file.path}
                </span>
                {file.truncated && (
                  <span className="text-[9.5px] font-mono shrink-0" style={{ color: t.warn.fg }}>
                    已截断
                  </span>
                )}
              </div>
              {file.content ? (
                <CodeBlock content={file.content} compact={compact} variant={variant} />
              ) : (
                <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: t.cardBg, color: t.mutedSoft, boxShadow: `0 0 0 1px ${t.cardBorder}` }}>
                  {file.error || '测试代码未写入报告'}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: t.cardBg, color: t.mutedSoft, boxShadow: `0 0 0 1px ${t.cardBorder}` }}>
            暂无生成测试代码快照
          </div>
        )}
      </div>

      {/* ─── Execution output ─── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2" style={{ color: t.muted }}>
          <Terminal className="w-3.5 h-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">执行输出</span>
        </div>
        {visibleRuns.length > 0 ? (
          visibleRuns.map((run, index) => (
            <div key={`${run.test_path || 'run'}-${index}`} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-mono">
                <span style={{ color: run.success ? t.ok.fg : t.bad.fg, fontWeight: 600 }}>
                  {run.success ? '通过' : '失败'} · {run.test_path || report.test_file || 'pytest'}
                </span>
                <span style={{ color: t.muted }}>{run.summary || report.summary}</span>
              </div>
              <TerminalBlock title="stdout" text={run.stdout || ''} compact={compact} variant={variant} />
              <TerminalBlock title="stderr" text={run.stderr || run.error || ''} compact={compact} variant={variant} />
            </div>
          ))
        ) : (
          <TerminalBlock title="error_log" text={report.error_log || '暂无执行输出'} compact={compact} variant={variant} />
        )}
      </div>

      {/* ─── Validation commands ─── */}
      {commands.length > 0 && !compact && (
        <div className="space-y-3">
          <div className="flex items-center gap-2" style={{ color: t.muted }}>
            <PlayCircle className="w-3.5 h-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">项目级验证命令</span>
          </div>
          {commands.map((command, index) => (
            <div key={`${command.command || 'command'}-${index}`} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-mono">
                <span style={{ color: command.success ? t.ok.fg : t.bad.fg, fontWeight: 600 }}>
                  {command.success ? '通过' : '失败'} · {command.command || command.normalized_command || 'validation'}
                </span>
                <span style={{ color: t.muted }}>
                  {command.summary || command.error || `exit ${command.exit_code ?? '-'}`}
                </span>
              </div>
              <TerminalBlock title="stdout" text={command.stdout || ''} compact={compact} variant={variant} />
              <TerminalBlock title="stderr" text={command.stderr || command.error || ''} compact={compact} variant={variant} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
