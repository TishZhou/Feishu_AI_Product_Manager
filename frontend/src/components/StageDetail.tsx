import { useEffect, useMemo, useState } from 'react'
import type { StageResult, Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { FileCode2, Clock, Cpu, AlertTriangle, Hash, Zap, ArrowRight, Eye } from 'lucide-react'
import { apiClient } from '../lib/api'
import { parseTestReport } from '../lib/testReport'
import { TestReportView } from './TestReportView'

interface StageDetailProps {
  stages: StageResult[]
  artifacts: Artifact[]
  onSelectArtifact: (artifact: Artifact) => void
  viewingStageKey?: string | null
  onClearViewing?: () => void
}

const STATUS_CN: Record<string, string> = {
  running: '推理中', succeeded: '已完成', failed: '已失败',
  rejected: '已拒绝', pending: '等待中', skipped: '已跳过',
}

/* Low-saturation status colors — no neon */
const STATUS_CFG: Record<string, {
  dot: string; text: string; badgeBg: string; badgeBorder: string; topLine: string
}> = {
  running:   { dot: 'rgba(215,228,255,0.85)', text: 'rgba(215,228,255,0.85)', badgeBg: 'rgba(255,255,255,0.05)', badgeBorder: 'rgba(255,255,255,0.12)', topLine: 'rgba(255,255,255,0.12)' },
  succeeded: { dot: 'rgba(255,255,255,0.55)', text: 'rgba(255,255,255,0.55)', badgeBg: 'rgba(255,255,255,0.04)', badgeBorder: 'rgba(255,255,255,0.10)', topLine: 'rgba(255,255,255,0.10)' },
  failed:    { dot: 'rgba(255,180,175,0.60)', text: 'rgba(255,180,175,0.60)', badgeBg: 'rgba(255,255,255,0.04)', badgeBorder: 'rgba(255,180,175,0.18)', topLine: 'rgba(255,180,175,0.22)' },
  rejected:  { dot: 'rgba(255,215,145,0.55)', text: 'rgba(255,215,145,0.55)', badgeBg: 'rgba(255,255,255,0.04)', badgeBorder: 'rgba(255,215,145,0.18)', topLine: 'rgba(255,215,145,0.22)' },
  pending:   { dot: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.14)', badgeBg: 'rgba(255,255,255,0.03)', badgeBorder: 'rgba(255,255,255,0.07)', topLine: 'transparent' },
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <span className="text-[9px] font-medium uppercase tracking-[0.22em]"
        style={{ color: 'rgba(255,255,255,0.22)' }}>
        {children}
      </span>
      <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
    </div>
  )
}

function formatDur(s: number) {
  if (!s) return ''
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
  return `${(s / 60).toFixed(1)}m`
}

function latestStageForKey(stages: StageResult[], key: string) {
  return stages
    .filter(stage => stage.stage_key === key)
    .sort((a, b) => b.attempt - a.attempt)[0]
}

export function StageDetail({ stages, artifacts, onSelectArtifact, viewingStageKey, onClearViewing }: StageDetailProps) {
  const latestStages = useMemo(
    () => STAGES.map(stage => latestStageForKey(stages, stage.key)).filter((stage): stage is StageResult => !!stage),
    [stages],
  )

  const activeStage = useMemo(() => {
    if (!latestStages.length) return null
    return (
      latestStages.find(s => s.status === 'running') ??
      latestStages.find(s => s.status === 'failed') ??
      [...latestStages].reverse().find(s => s.status !== 'pending') ??
      latestStages[latestStages.length - 1]
    )
  }, [latestStages])

  const viewedStage = useMemo(() =>
    viewingStageKey ? latestStageForKey(stages, viewingStageKey) ?? null : null,
  [stages, viewingStageKey])

  const displayStage    = viewedStage ?? activeStage
  const isViewingHistory = !!viewedStage && viewedStage !== activeStage
  const displayStageKey = displayStage?.stage_key ?? ''

  const testReportArtifact = useMemo(() => {
    if (displayStageKey !== 'test_generation') return null
    return artifacts.find(a => a.stage_key === 'test_generation' && a.filename === 'test_report.json') ?? null
  }, [artifacts, displayStageKey])

  const [testReportContent, setTestReportContent] = useState('')

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setTestReportContent('')
    })
    if (!testReportArtifact) return () => { active = false }

    apiClient.getArtifactContent(testReportArtifact).then((data) => {
      if (!active) return
      setTestReportContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
    })

    return () => { active = false }
  }, [testReportArtifact])

  const hasVisualTestReport = !!parseTestReport(testReportContent)

  if (!displayStage) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.03)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}>
            <Cpu className="w-6 h-6" style={{ color: 'rgba(255,255,255,0.20)' }} />
          </div>
          <div>
            <p className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>等待流水线启动</p>
            <p className="text-[11px] mt-1.5" style={{ color: 'rgba(255,255,255,0.16)' }}>启动后可在此查看实时进度</p>
          </div>
        </div>
      </div>
    )
  }

  const stageDef  = STAGES.find(s => s.key === displayStage.stage_key)
  const stageArts = artifacts.filter(a => a.stage_key === displayStage.stage_key)
  const st        = displayStage.status
  const cfg       = STATUS_CFG[st] ?? STATUS_CFG.pending
  const isRunning = st === 'running'

  const succeededCount = latestStages.filter(s => s.status === 'succeeded').length
  const runningStage   = latestStages.find(s => s.status === 'running')
  const runningDef     = runningStage ? STAGES.find(s => s.key === runningStage.stage_key) : null

  return (
    <div className="flex flex-col gap-7">

      {/* ── Viewing history banner ── */}
      {isViewingHistory && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl"
          style={{
            background: 'rgba(255,255,255,0.03)',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.06)',
            borderLeft: '2px solid rgba(255,215,145,0.35)',
          }}>
          <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: 'rgba(255,215,145,0.55)' }} />
          <p className="text-[11px] flex-1" style={{ color: 'rgba(255,215,145,0.65)' }}>
            查看: <span className="font-semibold">{stageDef?.label}</span>
          </p>
          <button onClick={onClearViewing}
            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70"
            style={{
              background: 'rgba(255,255,255,0.05)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.50)',
            }}>
            <ArrowRight className="w-2.5 h-2.5" />
            回到当前
          </button>
        </div>
      )}

      {/* ── Stage header card ── */}
      <div className="relative rounded-2xl p-5"
        style={{
          background: 'rgba(255,255,255,0.03)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.12), 0 4px 28px rgba(0,0,0,0.22)',
        }}>
        {/* Colored top accent line */}
        <div className="absolute top-0 left-[20%] right-[20%] h-px rounded-full"
          style={{ background: cfg.topLine }} />

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-[0.24em] mb-3"
              style={{ color: 'rgba(255,255,255,0.22)' }}>
              {isViewingHistory ? '查看阶段' : '当前阶段'}
            </p>
            <h2 className="text-[20px] font-semibold tracking-tight mb-4 truncate"
              style={{ color: 'rgba(255,255,255,0.88)', letterSpacing: '-0.025em' }}>
              {stageDef?.label || displayStage.stage_key}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full text-[10px] font-medium"
                style={{
                  background: cfg.badgeBg,
                  boxShadow: `0 0 0 1px ${cfg.badgeBorder}`,
                  color: cfg.text,
                }}>
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'animate-pulse' : ''}`}
                  style={{ background: cfg.dot }}
                />
                {STATUS_CN[st] || st}
              </div>

              {/* Provider */}
              {displayStage.provider && (
                <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full text-[10px] font-mono"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.38)',
                  }}>
                  <Zap className="w-3 h-3" />
                  {displayStage.provider}
                </div>
              )}

              {/* Duration */}
              {displayStage.duration_seconds > 0 && (
                <div className="flex items-center gap-1 text-[10px] font-mono"
                  style={{ color: 'rgba(255,255,255,0.28)' }}>
                  <Clock className="w-3 h-3" />
                  {formatDur(displayStage.duration_seconds)}
                </div>
              )}
            </div>
          </div>

          {/* Attempt */}
          <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-xl shrink-0"
            style={{
              background: 'rgba(255,255,255,0.03)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.07)',
            }}>
            <Hash className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.18)' }} />
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>
              第 {displayStage.attempt} 次
            </span>
          </div>
        </div>
      </div>

      {/* ── Error block ── */}
      {displayStage.error_message && (
        <div className="flex gap-3 px-4 py-4 rounded-2xl"
          style={{
            background: 'rgba(255,255,255,0.02)',
            boxShadow: '0 0 0 1px rgba(255,180,175,0.15), inset 0 1px 0 rgba(255,255,255,0.04)',
            borderLeft: '2px solid rgba(255,180,175,0.35)',
          }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'rgba(255,180,175,0.60)' }} />
          <pre className="whitespace-pre-wrap text-[11px] font-mono leading-relaxed"
            style={{ color: 'rgba(255,180,175,0.65)' }}>
            {displayStage.error_message}
          </pre>
        </div>
      )}

      {/* ── Visual test report ── */}
      {testReportArtifact && hasVisualTestReport && (
        <div>
          <SectionLabel>测试结果</SectionLabel>
          <TestReportView content={testReportContent} compact />
        </div>
      )}

      {/* ── Artifacts ── */}
      <div>
        <SectionLabel>输出产物</SectionLabel>
        {stageArts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stageArts.map(artifact => (
              <button key={artifact.id} onClick={() => onSelectArtifact(artifact)}
                className="artifact-chip flex items-center gap-2 px-3 py-[7px] rounded-xl">
                <FileCode2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }} />
                <span className="text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.60)' }}>
                  {artifact.filename}
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md"
                  title={`artifacts/${artifact.run_id}/`}
                  style={{ color: 'rgba(255,255,255,0.28)', background: 'rgba(51,112,255,0.08)' }}>
                  artifacts/{artifact.run_id.slice(0, 8)}
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md"
                  style={{ color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.04)' }}>
                  {(artifact.size_bytes / 1024).toFixed(1)}k
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] pl-1" style={{ color: 'rgba(255,255,255,0.18)' }}>暂无产物</p>
        )}
      </div>

      {/* ── Progress — single thin line ── */}
      <div>
        <SectionLabel>全部阶段</SectionLabel>

        {/* Thin segmented line */}
        <div className="flex gap-[3px]">
          {STAGES.map(s => {
            const r    = stages.find(sr => sr.stage_key === s.key)
            const done = r?.status === 'succeeded'
            const run  = r?.status === 'running'
            return (
              <div
                key={s.key}
                className="flex-1 rounded-full transition-all duration-700"
                style={{
                  height: 1,
                  background: done
                    ? 'rgba(255,255,255,0.72)'
                    : run
                    ? 'rgba(255,255,255,0.35)'
                    : 'rgba(255,255,255,0.10)',
                }}
              />
            )
          })}
        </div>

        {/* Minimal caption */}
        <div className="flex items-center justify-between mt-2.5">
          <span className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.20)' }}>
            {succeededCount} / {STAGES.length}
          </span>
          {runningDef && (
            <span className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.20)' }}>
              {runningDef.label}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
