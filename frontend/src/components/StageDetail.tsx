import { useMemo } from 'react'
import type { StageResult, Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { FileCode2, Clock, Cpu, AlertTriangle, Hash, Zap, ArrowRight, Eye } from 'lucide-react'

interface StageDetailProps {
  stages: StageResult[]
  artifacts: Artifact[]
  onSelectArtifact: (artifact: Artifact) => void
  viewingStageKey?: string | null
  onClearViewing?: () => void
}

const STATUS_CN: Record<string, string> = {
  running:   '推理中',
  succeeded: '已完成',
  failed:    '已失败',
  rejected:  '已拒绝',
  pending:   '等待中',
  skipped:   '已跳过',
}

const STATUS_CFG: Record<string, { dot: string; text: string; bg: string; top: string; bottom: string }> = {
  running:   { dot: '#60a5fa', text: '#93c5fd', bg: 'rgba(59,130,246,0.12)',  top: 'rgba(59,130,246,0.15)',  bottom: 'transparent' },
  succeeded: { dot: '#34d399', text: '#6ee7b7', bg: 'rgba(16,185,129,0.12)', top: 'rgba(16,185,129,0.12)',  bottom: 'transparent' },
  failed:    { dot: '#f87171', text: '#fca5a5', bg: 'rgba(239,68,68,0.12)',   top: 'rgba(239,68,68,0.12)',   bottom: 'transparent' },
  rejected:  { dot: '#fbbf24', text: '#fcd34d', bg: 'rgba(245,158,11,0.12)', top: 'rgba(245,158,11,0.12)', bottom: 'transparent' },
  pending:   { dot: '#475569', text: '#64748b', bg: 'rgba(255,255,255,0.04)', top: 'transparent',           bottom: 'transparent' },
  skipped:   { dot: '#475569', text: '#64748b', bg: 'rgba(255,255,255,0.04)', top: 'transparent',           bottom: 'transparent' },
}

const STAGE_PROGRESS_COLOR: Record<string, string> = {
  succeeded: '#34d399',
  running:   '#60a5fa',
  failed:    '#f87171',
  rejected:  '#fbbf24',
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 shrink-0">{children}</span>
      <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
    </div>
  )
}

export function StageDetail({ stages, artifacts, onSelectArtifact, viewingStageKey, onClearViewing }: StageDetailProps) {
  const activeStage = useMemo(() => {
    if (stages.length === 0) return null
    const running = stages.find(s => s.status === 'running')
    if (running) return running
    return stages[stages.length - 1]
  }, [stages])

  const viewedStage = useMemo(() => {
    if (!viewingStageKey) return null
    return stages.find(s => s.stage_key === viewingStageKey) ?? null
  }, [stages, viewingStageKey])

  const displayStage = viewedStage ?? activeStage
  const isViewingHistory = !!viewedStage && viewedStage !== activeStage

  if (!displayStage) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Cpu className="w-7 h-7 text-slate-700" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-500">等待流水线启动</p>
            <p className="text-xs text-slate-700 mt-1">启动后可在此查看实时进度</p>
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

  return (
    <div className="flex flex-col gap-5">
      {/* ── Viewing history banner ── */}
      {isViewingHistory && (
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl"
          style={{
            background: 'rgba(251,191,36,0.08)',
            borderTop: '1px solid rgba(251,191,36,0.22)',
            borderRight: '1px solid rgba(251,191,36,0.22)',
            borderBottom: '1px solid rgba(251,191,36,0.22)',
            borderLeft: '3px solid rgba(251,191,36,0.65)',
          }}
        >
          <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: '#fcd34d' }} />
          <p className="text-xs flex-1" style={{ color: '#fcd34d' }}>
            正在查看已完成阶段: <span className="font-semibold">{stageDef?.label}</span>
          </p>
          <button
            onClick={onClearViewing}
            className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all"
            style={{ background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.28)', color: '#fbbf24' }}
          >
            <ArrowRight className="w-2.5 h-2.5" />
            回到当前
          </button>
        </div>
      )}

      {/* ── Stage header card ── */}
      <div
        className="relative rounded-2xl overflow-hidden p-4"
        style={{
          background: `linear-gradient(135deg, ${cfg.top} 0%, rgba(13,25,48,0.7) 100%)`,
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: isRunning
            ? `0 0 40px rgba(59,130,246,0.15), inset 0 1px 0 rgba(255,255,255,0.08)`
            : 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Decorative top line */}
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg,transparent,${cfg.dot}66,transparent)` }} />

        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.20em] text-slate-600 mb-2">
              {isViewingHistory ? '查看阶段' : '当前阶段'}
            </p>
            <h2 className="text-[22px] font-bold tracking-tight text-white mb-3 truncate"
              style={{ letterSpacing: '-0.02em' }}>
              {stageDef?.label || displayStage.stage_key}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{ background: cfg.bg, border: `1px solid ${cfg.dot}44`, color: cfg.text }}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'animate-pulse' : ''}`}
                  style={{ background: cfg.dot, boxShadow: isRunning ? `0 0 6px ${cfg.dot}` : 'none' }} />
                {STATUS_CN[st] || st}
              </div>

              {displayStage.provider && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-mono"
                  style={{ background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.22)', color: '#c4b5fd' }}>
                  <Zap className="w-3 h-3" />
                  <span>{displayStage.provider}</span>
                </div>
              )}

              {displayStage.duration_seconds > 0 && (
                <div className="flex items-center gap-1 text-[11px] font-mono"
                  style={{ color: '#475569' }}>
                  <Clock className="w-3 h-3" />
                  <span>{displayStage.duration_seconds}s</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shrink-0"
            style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Hash className="w-3 h-3 text-slate-600" />
            <span className="text-[11px] font-mono text-slate-500">第 {displayStage.attempt} 次</span>
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {displayStage.error_message && (
        <div className="flex gap-3 p-4 rounded-xl"
          style={{
            background: 'rgba(239,68,68,0.07)',
            borderTop: '1px solid rgba(248,113,113,0.20)',
            borderRight: '1px solid rgba(248,113,113,0.20)',
            borderBottom: '1px solid rgba(248,113,113,0.20)',
            borderLeft: '3px solid rgba(248,113,113,0.75)',
          }}>
          <AlertTriangle className="w-4 h-4 text-[#f87171] shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-[#fca5a5] text-[11px] font-mono leading-relaxed">{displayStage.error_message}</pre>
        </div>
      )}

      {/* ── Output Artifacts ── */}
      <div>
        <SectionLabel>输出产物</SectionLabel>
        {stageArts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stageArts.map(artifact => (
              <button
                key={artifact.id}
                onClick={() => onSelectArtifact(artifact)}
                className="artifact-chip flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
              >
                <FileCode2 className="w-3.5 h-3.5 text-[#60a5fa]" />
                <span className="text-xs font-mono text-slate-300">{artifact.filename}</span>
                <span className="text-[10px] font-mono text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-md">
                  {(artifact.size_bytes / 1024).toFixed(1)}k
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-700 italic pl-1">暂无产物生成</p>
        )}
      </div>

      {/* ── All stages progress ── */}
      <div>
        <SectionLabel>全部阶段进度</SectionLabel>
        <div className="flex gap-1.5">
          {STAGES.map(s => {
            const r  = stages.find(sr => sr.stage_key === s.key)
            const rs = r?.status || 'pending'
            const color = STAGE_PROGRESS_COLOR[rs]
            return (
              <div key={s.key} className="group/seg flex-1 relative" title={`${s.label}${r?.duration_seconds ? ` · ${r.duration_seconds}s` : ''}`}>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{
                      background: color
                        ? `linear-gradient(90deg,${color}dd,${color}aa)`
                        : 'transparent',
                      boxShadow: rs === 'running' ? `0 0 10px ${color}aa` : 'none',
                      width: color ? '100%' : '0%',
                    }} />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/seg:opacity-100 pointer-events-none z-20 transition-opacity">
                  <div className="bg-slate-800 border border-slate-700 text-slate-200 text-[10px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl">
                    <span className="font-medium">{s.label}</span>
                    {r?.duration_seconds ? <span className="text-slate-400 ml-1.5 font-mono">{r.duration_seconds}s</span> : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-1.5 mt-2">
          {STAGES.map(s => {
            const r  = stages.find(sr => sr.stage_key === s.key)
            const rs = r?.status || 'pending'
            const color = STAGE_PROGRESS_COLOR[rs]
            return (
              <div key={s.key} className="flex-1 flex justify-center">
                <span className="text-[9px] font-bold tabular-nums" style={{ color: color ?? '#1e293b' }}>{s.index}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
