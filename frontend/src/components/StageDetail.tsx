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

/* Dot / text / card accent per status */
const STATUS_CFG: Record<string, {
  dot: string; text: string; badgeBg: string; badgeBorder: string
  cardBorder: string; topLine: string; glow: string
}> = {
  running:   {
    dot: '#60a5fa', text: '#93c5fd',
    badgeBg: 'rgba(37,99,235,0.18)', badgeBorder: 'rgba(99,162,255,0.30)',
    cardBorder: 'rgba(99,162,255,0.22)', topLine: 'rgba(99,162,255,0.40)',
    glow: '0 0 40px rgba(37,99,235,0.20)',
  },
  succeeded: {
    dot: '#34d399', text: '#6ee7b7',
    badgeBg: 'rgba(5,150,105,0.15)', badgeBorder: 'rgba(52,211,153,0.28)',
    cardBorder: 'rgba(52,211,153,0.18)', topLine: 'rgba(52,211,153,0.35)',
    glow: '0 0 32px rgba(5,150,105,0.12)',
  },
  failed:    {
    dot: '#f87171', text: '#fca5a5',
    badgeBg: 'rgba(185,28,28,0.15)', badgeBorder: 'rgba(248,113,113,0.28)',
    cardBorder: 'rgba(248,113,113,0.18)', topLine: 'rgba(248,113,113,0.35)',
    glow: '0 0 32px rgba(185,28,28,0.12)',
  },
  rejected:  {
    dot: '#fbbf24', text: '#fcd34d',
    badgeBg: 'rgba(161,98,7,0.15)', badgeBorder: 'rgba(251,191,36,0.28)',
    cardBorder: 'rgba(251,191,36,0.18)', topLine: 'rgba(251,191,36,0.35)',
    glow: '0 0 32px rgba(161,98,7,0.12)',
  },
  pending:   {
    dot: '#1e3a5f', text: '#1e3a5f',
    badgeBg: 'rgba(10,26,70,0.35)', badgeBorder: 'rgba(99,155,255,0.08)',
    cardBorder: 'rgba(99,155,255,0.10)', topLine: 'transparent',
    glow: 'none',
  },
}

const PROGRESS_COLOR: Record<string, string> = {
  succeeded: '#34d399', running: '#60a5fa', failed: '#f87171', rejected: '#fbbf24',
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-px flex-1" style={{ background: 'rgba(99,155,255,0.12)' }} />
      <span className="text-[9px] font-bold uppercase tracking-[0.20em]" style={{ color: 'rgba(99,155,255,0.40)' }}>
        {children}
      </span>
      <div className="h-px flex-1" style={{ background: 'rgba(99,155,255,0.12)' }} />
    </div>
  )
}

export function StageDetail({ stages, artifacts, onSelectArtifact, viewingStageKey, onClearViewing }: StageDetailProps) {
  const activeStage = useMemo(() => {
    if (!stages.length) return null
    return stages.find(s => s.status === 'running') ?? stages[stages.length - 1]
  }, [stages])

  const viewedStage = useMemo(() =>
    viewingStageKey ? stages.find(s => s.stage_key === viewingStageKey) ?? null : null,
  [stages, viewingStageKey])

  const displayStage    = viewedStage ?? activeStage
  const isViewingHistory = !!viewedStage && viewedStage !== activeStage

  if (!displayStage) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="glass-card w-16 h-16 rounded-2xl mx-auto flex items-center justify-center card-enter">
            <Cpu className="w-7 h-7" style={{ color: 'rgba(79,142,255,0.40)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'rgba(147,197,253,0.60)' }}>等待流水线启动</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(99,155,255,0.30)' }}>启动后可在此查看实时进度</p>
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
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl card-enter"
          style={{
            background: 'rgba(120,78,0,0.15)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderTop: '1px solid rgba(251,191,36,0.20)',
            borderRight: '1px solid rgba(251,191,36,0.20)',
            borderBottom: '1px solid rgba(251,191,36,0.20)',
            borderLeft: '3px solid rgba(251,191,36,0.60)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.07)',
          }}>
          <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: '#fcd34d' }} />
          <p className="text-xs flex-1" style={{ color: '#fcd34d' }}>
            正在查看: <span className="font-semibold">{stageDef?.label}</span>
          </p>
          <button onClick={onClearViewing}
            className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
            style={{
              background: 'rgba(251,191,36,0.14)',
              border: '1px solid rgba(251,191,36,0.25)',
              color: '#fbbf24',
            }}>
            <ArrowRight className="w-2.5 h-2.5" />
            回到当前
          </button>
        </div>
      )}

      {/* ── Stage header card ── */}
      <div className="relative rounded-2xl overflow-hidden p-4 card-enter"
        style={{
          background: 'rgba(10, 26, 70, 0.58)',
          backdropFilter: 'blur(22px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
          border: `1px solid ${cfg.cardBorder}`,
          boxShadow: `${cfg.glow}, 0 4px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)`,
        }}>
        {/* Colored top line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
          style={{ background: `linear-gradient(90deg,transparent,${cfg.topLine},transparent)` }} />

        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: 'rgba(99,162,255,0.45)' }}>
              {isViewingHistory ? '查看阶段' : '当前阶段'}
            </p>
            <h2 className="text-[22px] font-bold tracking-tight text-white mb-3 truncate">
              {stageDef?.label || displayStage.stage_key}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{
                  background: cfg.badgeBg,
                  border: `1px solid ${cfg.badgeBorder}`,
                  color: cfg.text,
                  backdropFilter: 'blur(8px)',
                }}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'animate-pulse' : ''}`}
                  style={{ background: cfg.dot, boxShadow: isRunning ? `0 0 6px ${cfg.dot}` : 'none' }} />
                {STATUS_CN[st] || st}
              </div>

              {/* Provider */}
              {displayStage.provider && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-mono"
                  style={{
                    background: 'rgba(79,70,229,0.15)',
                    border: '1px solid rgba(139,92,246,0.22)',
                    color: '#c4b5fd',
                    backdropFilter: 'blur(8px)',
                  }}>
                  <Zap className="w-3 h-3" />
                  {displayStage.provider}
                </div>
              )}

              {/* Duration */}
              {displayStage.duration_seconds > 0 && (
                <div className="flex items-center gap-1 text-[11px] font-mono" style={{ color: 'rgba(99,162,255,0.45)' }}>
                  <Clock className="w-3 h-3" />
                  {displayStage.duration_seconds}s
                </div>
              )}
            </div>
          </div>

          {/* Attempt badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shrink-0"
            style={{
              background: 'rgba(5,14,38,0.50)',
              border: '1px solid rgba(99,155,255,0.12)',
              backdropFilter: 'blur(10px)',
            }}>
            <Hash className="w-3 h-3" style={{ color: 'rgba(99,162,255,0.40)' }} />
            <span className="text-[11px] font-mono" style={{ color: 'rgba(99,162,255,0.50)' }}>第 {displayStage.attempt} 次</span>
          </div>
        </div>
      </div>

      {/* ── Error block ── */}
      {displayStage.error_message && (
        <div className="flex gap-3 p-4 rounded-xl"
          style={{
            background: 'rgba(30,10,20,0.55)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(248,113,113,0.18)',
            borderRight: '1px solid rgba(248,113,113,0.18)',
            borderBottom: '1px solid rgba(248,113,113,0.18)',
            borderLeft: '3px solid rgba(248,113,113,0.70)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}>
          <AlertTriangle className="w-4 h-4 text-[#f87171] shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-[#fca5a5] text-[11px] font-mono leading-relaxed">{displayStage.error_message}</pre>
        </div>
      )}

      {/* ── Artifacts ── */}
      <div>
        <SectionLabel>输出产物</SectionLabel>
        {stageArts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stageArts.map(artifact => (
              <button key={artifact.id} onClick={() => onSelectArtifact(artifact)}
                className="artifact-chip flex items-center gap-2 px-3 py-2 rounded-xl">
                <FileCode2 className="w-3.5 h-3.5" style={{ color: '#60a5fa' }} />
                <span className="text-xs font-mono text-blue-100">{artifact.filename}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
                  style={{ color: 'rgba(99,162,255,0.50)', background: 'rgba(10,26,70,0.50)' }}>
                  {(artifact.size_bytes / 1024).toFixed(1)}k
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs italic pl-1" style={{ color: 'rgba(99,155,255,0.28)' }}>暂无产物生成</p>
        )}
      </div>

      {/* ── All stages progress ── */}
      <div>
        <SectionLabel>全部阶段</SectionLabel>
        <div className="flex gap-1.5 mb-2">
          {STAGES.map(s => {
            const r  = stages.find(sr => sr.stage_key === s.key)
            const rs = r?.status || 'pending'
            const color = PROGRESS_COLOR[rs]
            return (
              <div key={s.key} className="group/seg flex-1 relative">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(10,26,70,0.55)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{
                      background: color ? `linear-gradient(90deg,${color}cc,${color}88)` : 'transparent',
                      boxShadow: rs === 'running' ? `0 0 10px ${color}` : 'none',
                      width: color ? '100%' : '0%',
                    }} />
                </div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/seg:opacity-100 pointer-events-none z-20 transition-opacity">
                  <div className="glass-card text-[10px] px-2.5 py-1.5 rounded-lg whitespace-nowrap" style={{ borderRadius: 8 }}>
                    <span className="font-medium text-blue-100">{s.label}</span>
                    {r?.duration_seconds ? <span className="ml-1.5 font-mono" style={{ color: 'rgba(99,162,255,0.60)' }}>{r.duration_seconds}s</span> : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-1.5">
          {STAGES.map(s => {
            const r  = stages.find(sr => sr.stage_key === s.key)
            const rs = r?.status || 'pending'
            const color = PROGRESS_COLOR[rs]
            return (
              <div key={s.key} className="flex-1 flex justify-center">
                <span className="text-[9px] font-bold tabular-nums" style={{ color: color ?? 'rgba(10,26,70,0.8)' }}>
                  {s.index}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
