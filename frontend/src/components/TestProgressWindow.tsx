import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, CircleDashed, FileCode2, ListChecks, Terminal, XCircle } from 'lucide-react'
import type { StageResult, TestCaseResult, TestProgress } from '../types/api'
import { useTestProgress } from '../hooks/useDevFlow'

interface TestProgressWindowProps {
  runId: string
  stages: StageResult[]
}

const STATUS_LABEL: Record<string, string> = {
  idle: '等待测试',
  preparing: '准备测试',
  running: '测试中',
  passed: '全部通过',
  failed: '测试失败',
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return 0
}

function statusTone(status: string) {
  if (status === 'passed') return { color: 'rgba(120,255,190,0.78)', bg: 'rgba(16,185,129,0.13)' }
  if (status === 'failed') return { color: 'rgba(255,180,175,0.78)', bg: 'rgba(239,68,68,0.13)' }
  if (status === 'skipped') return { color: 'rgba(255,220,150,0.72)', bg: 'rgba(245,158,11,0.12)' }
  return { color: 'rgba(191,219,254,0.76)', bg: 'rgba(59,130,246,0.12)' }
}

function normalizeCases(progress: TestProgress | undefined): TestCaseResult[] {
  if (!progress) return []
  if (Array.isArray(progress.test_cases) && progress.test_cases.length) return progress.test_cases
  const latestByPath = new Map<string, TestCaseResult>()
  const runs = progress.runs ?? []
  runs.forEach((run, index) => {
    const path = run.test_path || `pytest run ${index + 1}`
    latestByPath.set(path, {
      id: `RUN-${index + 1}`,
      name: path,
      status: run.success === undefined || run.success === null ? 'running' : run.success ? 'passed' : 'failed',
      message: run.summary || run.error || '',
    })
  })
  return Array.from(latestByPath.values()).map((test, index) => ({
    id: `RUN-${index + 1}`,
    name: test.name,
    status: test.status,
    message: test.message,
  }))
}

function TestDot({ status }: { status: string }) {
  const failed = status === 'failed'
  const passed = status === 'passed'
  const Icon = passed ? CheckCircle2 : failed ? XCircle : CircleDashed
  const tone = statusTone(status)
  return <Icon className={`w-3.5 h-3.5 shrink-0 ${status === 'running' ? 'animate-spin' : ''}`} style={{ color: tone.color }} />
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <p className="text-[9px] uppercase tracking-[0.16em]" style={{ color: 'rgba(255,255,255,0.34)' }}>{label}</p>
      <p className="text-sm font-mono mt-0.5" style={{ color: tone }}>{value}</p>
    </div>
  )
}

export function TestProgressWindow({ runId, stages }: TestProgressWindowProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { data: progress } = useTestProgress(runId)
  const testStage = stages.find(stage => stage.stage_key === 'test_generation')
  const hasStarted = !!testStage && testStage.status !== 'pending'
  const isLive = progress?.status === 'preparing' || progress?.status === 'running' || testStage?.status === 'running'
  const shouldRender = hasStarted || isLive || (progress?.status && progress.status !== 'idle')

  const cases = useMemo(() => normalizeCases(progress), [progress])
  const total = asNumber(progress?.total) || cases.length
  const passed = asNumber(progress?.passed) || cases.filter(test => test.status === 'passed').length
  const failed = asNumber(progress?.failed) || cases.filter(test => test.status === 'failed').length
  const skipped = asNumber(progress?.skipped) || cases.filter(test => test.status === 'skipped').length
  const status = progress?.status ?? (testStage?.status === 'running' ? 'running' : 'idle')
  const tone = statusTone(status === 'passed' && failed === 0 ? 'passed' : status === 'failed' || failed > 0 ? 'failed' : 'running')
  const events = progress?.events ?? []

  if (!shouldRender) return null

  return (
    <div
      className="absolute right-5 z-20 w-[560px] max-w-[calc(100%-40px)] rounded-2xl overflow-hidden"
      style={{
        bottom: 'calc(42% + 16px)',
        background: 'rgba(13,17,23,0.96)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.48), 0 0 0 1px rgba(51,112,255,0.10)',
        backdropFilter: 'blur(18px)',
      }}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3" style={{ background: 'rgba(255,255,255,0.035)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: tone.bg, border: `1px solid ${tone.color}` }}>
            <TestDot status={status === 'preparing' ? 'running' : status} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'rgba(255,255,255,0.88)' }}>
              {STATUS_LABEL[status] || status}
            </p>
            <p className="text-[10px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>
              {progress?.active_test_path || progress?.test_files?.[0] || 'pytest'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
          aria-label={collapsed ? '展开测试窗口' : '收起测试窗口'}
        >
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4 max-h-[52vh] overflow-auto">
          <div className="grid grid-cols-4 gap-2">
            <MiniStat label="total" value={total} tone="rgba(226,232,240,0.82)" />
            <MiniStat label="passed" value={passed} tone="rgba(120,255,190,0.78)" />
            <MiniStat label="failed" value={failed} tone={failed ? 'rgba(255,180,175,0.78)' : 'rgba(226,232,240,0.42)'} />
            <MiniStat label="skipped" value={skipped} tone={skipped ? 'rgba(255,220,150,0.72)' : 'rgba(226,232,240,0.42)'} />
          </div>

          <div className="grid grid-cols-[1fr_1.15fr] gap-3">
            <div className="min-w-0 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.48)' }}>
                <ListChecks className="w-3.5 h-3.5" />
                <span className="text-[10px] uppercase tracking-[0.16em]">tests</span>
              </div>
              <div className="max-h-52 overflow-auto">
                {cases.length ? cases.map((test, index) => {
                  const caseStatus = test.status || 'running'
                  return (
                    <div key={`${test.id || test.name || index}`} className="flex items-start gap-2 px-3 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.055)' }}>
                      <TestDot status={caseStatus} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.72)' }}>{test.name || test.id || 'pytest'}</p>
                        {test.message && <p className="text-[10px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.34)' }}>{test.message}</p>}
                      </div>
                    </div>
                  )
                }) : (
                  <div className="px-3 py-6 text-[11px]" style={{ color: 'rgba(255,255,255,0.34)' }}>等待 pytest 输出测试用例</div>
                )}
              </div>
            </div>

            <div className="min-w-0 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.48)' }}>
                <Terminal className="w-3.5 h-3.5" />
                <span className="text-[10px] uppercase tracking-[0.16em]">live output</span>
              </div>
              <pre className="m-0 p-3 h-52 overflow-auto text-[10px] leading-5 whitespace-pre-wrap" style={{ color: 'rgba(203,213,225,0.82)', background: 'rgba(0,0,0,0.24)' }}>
                {events.length
                  ? events.slice(-120).map(event => `${event.stream === 'system' ? '$' : event.stream} ${event.line}`).join('\n')
                  : 'pytest output will appear here'}
              </pre>
            </div>
          </div>

          {(progress?.test_files?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {progress?.test_files.map(file => (
                <div key={file} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono" style={{ background: 'rgba(255,255,255,0.045)', color: 'rgba(255,255,255,0.52)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <FileCode2 className="w-3 h-3" />
                  {file}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
