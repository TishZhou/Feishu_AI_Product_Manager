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
import type { GeneratedTestFile, TestCaseResult, TestReport, TestRunResult } from '../types/api'

interface TestReportViewProps {
  content: string
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
}

export function parseTestReport(content: string): TestReport | null {
  if (!content.trim()) return null
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as TestReport
    if (
      'test_file' in candidate ||
      'test_files' in candidate ||
      'test_cases' in candidate ||
      'runner_validation' in candidate ||
      'generated_test_files' in candidate
    ) {
      return candidate
    }
  } catch {
    return null
  }
  return null
}

function normalizeReport(content: string): NormalizedReport | null {
  const report = parseTestReport(content)
  if (!report) return null
  const runs = Array.isArray(report.runner_validation?.runs) ? report.runner_validation.runs : []
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
  }
}

function asNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return 0
}

function StatPill({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'bad' | 'muted' | 'warn' }) {
  const colors = {
    ok: ['rgba(80,220,155,0.18)', 'rgba(120,255,190,0.72)'],
    bad: ['rgba(255,120,112,0.15)', 'rgba(255,180,175,0.76)'],
    warn: ['rgba(255,205,120,0.14)', 'rgba(255,220,150,0.70)'],
    muted: ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.46)'],
  }[tone]
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
      style={{
        background: colors[0],
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.42)' }}>{label}</span>
      <span className="text-sm font-mono font-semibold" style={{ color: colors[1] }}>{value}</span>
    </div>
  )
}

function ResultBar({ passed, failed, skipped, total }: { passed: number; failed: number; skipped: number; total: number }) {
  const denominator = Math.max(total, passed + failed + skipped, 1)
  const segments = [
    { key: 'passed', value: passed, color: 'rgba(80,220,155,0.76)' },
    { key: 'failed', value: failed, color: 'rgba(255,120,112,0.78)' },
    { key: 'skipped', value: skipped, color: 'rgba(255,205,120,0.64)' },
  ]
  return (
    <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.08)' }}>
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

function CodeBlock({ content, compact }: { content: string; compact?: boolean }) {
  const lines = content.split('\n')
  return (
    <div
      className="overflow-auto rounded-xl"
      style={{
        maxHeight: compact ? 220 : 420,
        background: '#0d1117',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
      }}
    >
      <div className="text-xs font-mono leading-5 py-3 min-w-max">
        {lines.map((line, index) => (
          <div key={`${index}-${line}`} className="flex">
            <span
              className="select-none shrink-0 px-3 text-right"
              style={{ width: 48, color: 'rgba(148,163,184,0.42)' }}
            >
              {index + 1}
            </span>
            <span className="pr-4 whitespace-pre" style={{ color: 'rgba(203,213,225,0.86)' }}>
              {line || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TerminalBlock({ title, text, compact }: { title: string; text: string; compact?: boolean }) {
  if (!text.trim()) return null
  const display = compact && text.length > 1600 ? `${text.slice(-1600)}\n...` : text
  return (
    <div className="rounded-xl overflow-hidden" style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.08)' }}>
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.48)' }}
      >
        <Terminal className="w-3.5 h-3.5" />
        <span className="text-[10px] font-mono">{title}</span>
      </div>
      <pre
        className="m-0 overflow-auto p-3 text-[11px] leading-5 whitespace-pre-wrap"
        style={{
          maxHeight: compact ? 180 : 320,
          background: 'rgba(0,0,0,0.30)',
          color: 'rgba(203,213,225,0.82)',
        }}
      >
        {display}
      </pre>
    </div>
  )
}

function TestCaseRow({ test }: { test: TestCaseResult }) {
  const status = test.status ?? 'unknown'
  const ok = status === 'passed'
  const failed = status === 'failed'
  const Icon = ok ? CheckCircle2 : failed ? XCircle : AlertTriangle
  const color = ok ? 'rgba(120,255,190,0.72)' : failed ? 'rgba(255,180,175,0.76)' : 'rgba(255,220,150,0.70)'
  return (
    <div className="flex items-start gap-2 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color }} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.70)' }}>
          {test.name || test.id || 'unnamed test'}
        </p>
        {test.message && (
          <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.36)' }}>
            {test.message}
          </p>
        )}
      </div>
      <span className="text-[9px] font-mono shrink-0 uppercase" style={{ color }}>{status}</span>
    </div>
  )
}

export function TestReportView({ content, compact = false }: TestReportViewProps) {
  const normalized = normalizeReport(content)
  if (!normalized) return null

  const { report, total, passed, failed, skipped, exitCode, success, tests, files, runs } = normalized
  const primaryRun = runs[0]
  const statusColor = success ? 'rgba(120,255,190,0.76)' : 'rgba(255,180,175,0.78)'
  const StatusIcon = success ? CheckCircle2 : XCircle
  const visibleFiles = compact ? files.slice(0, 1) : files
  const visibleRuns = compact ? runs.slice(0, 1) : runs

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5 p-5'}>
      <div
        className="rounded-2xl p-4"
        style={{
          background: 'rgba(255,255,255,0.03)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="p-2 rounded-xl shrink-0"
              style={{
                background: success ? 'rgba(80,220,155,0.12)' : 'rgba(255,120,112,0.12)',
                boxShadow: `0 0 0 1px ${success ? 'rgba(80,220,155,0.24)' : 'rgba(255,120,112,0.22)'}`,
              }}
            >
              <StatusIcon className="w-4 h-4" style={{ color: statusColor }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.86)' }}>
                {success ? '测试通过' : '测试未通过'}
              </p>
              <p className="text-[11px] mt-1 font-mono truncate" style={{ color: 'rgba(255,255,255,0.42)' }}>
                {report.test_command || primaryRun?.test_path || 'pytest'}
              </p>
              {report.summary && (
                <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.52)' }}>
                  {report.summary}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.38)' }}>
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
          <StatPill label="Total" value={total} tone="muted" />
          <StatPill label="Passed" value={passed} tone="ok" />
          <StatPill label="Failed" value={failed} tone={failed ? 'bad' : 'muted'} />
          <StatPill label="Skipped" value={skipped} tone={skipped ? 'warn' : 'muted'} />
        </div>
        <div className="mt-4">
          <ResultBar passed={passed} failed={failed} skipped={skipped} total={total} />
        </div>
      </div>

      {tests.length > 0 && !compact && (
        <div>
          <div className="flex items-center gap-2 mb-2" style={{ color: 'rgba(255,255,255,0.48)' }}>
            <ListChecks className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium uppercase tracking-[0.18em]">test cases</span>
          </div>
          <div className="rounded-xl px-3" style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 0 0 1px rgba(255,255,255,0.07)' }}>
            {tests.map((test, index) => <TestCaseRow key={`${test.id || test.name || 'case'}-${index}`} test={test} />)}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.48)' }}>
          <FileCode2 className="w-3.5 h-3.5" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em]">generated test code</span>
        </div>
        {visibleFiles.length > 0 ? (
          visibleFiles.map((file) => (
            <div key={file.path} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.62)' }}>
                  {file.path}
                </span>
                {file.truncated && (
                  <span className="text-[9px] font-mono shrink-0" style={{ color: 'rgba(255,220,150,0.66)' }}>
                    truncated
                  </span>
                )}
              </div>
              {file.content ? (
                <CodeBlock content={file.content} compact={compact} />
              ) : (
                <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.34)' }}>
                  {file.error || '测试代码未写入报告'}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.34)' }}>
            暂无生成测试代码快照
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.48)' }}>
          <Terminal className="w-3.5 h-3.5" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em]">execution output</span>
        </div>
        {visibleRuns.length > 0 ? (
          visibleRuns.map((run, index) => (
            <div key={`${run.test_path || 'run'}-${index}`} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                <span style={{ color: run.success ? 'rgba(120,255,190,0.70)' : 'rgba(255,180,175,0.74)' }}>
                  {run.success ? 'passed' : 'failed'} · {run.test_path || report.test_file || 'pytest'}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.32)' }}>{run.summary || report.summary}</span>
              </div>
              <TerminalBlock title="stdout" text={run.stdout || ''} compact={compact} />
              <TerminalBlock title="stderr" text={run.stderr || run.error || ''} compact={compact} />
            </div>
          ))
        ) : (
          <TerminalBlock title="error_log" text={report.error_log || '暂无执行输出'} compact={compact} />
        )}
      </div>
    </div>
  )
}
