import { useMemo } from 'react'
import type { StageResult, Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { FileCode2, Clock, Cpu, AlertTriangle, Hash, Zap } from 'lucide-react'

interface StageDetailProps {
  stages: StageResult[]
  artifacts: Artifact[]
  onSelectArtifact: (artifact: Artifact) => void
}

const STATUS_CN: Record<string, string> = {
  running:   '推理中',
  succeeded: '已完成',
  failed:    '已失败',
  rejected:  '已拒绝',
  pending:   '等待中',
  skipped:   '已跳过',
}

const STATUS_CONFIG: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  running:   { dot: '#60a5fa', text: '#93c5fd', bg: 'rgba(59,130,246,0.10)', border: 'rgba(99,132,255,0.30)' },
  succeeded: { dot: '#34d399', text: '#6ee7b7', bg: 'rgba(16,185,129,0.10)', border: 'rgba(52,211,153,0.30)' },
  failed:    { dot: '#f87171', text: '#fca5a5', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(248,113,113,0.30)' },
  rejected:  { dot: '#fbbf24', text: '#fcd34d', bg: 'rgba(245,158,11,0.10)', border: 'rgba(251,191,36,0.30)' },
  pending:   { dot: '#475569', text: '#64748b', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' },
  skipped:   { dot: '#475569', text: '#64748b', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' },
}

const STAGE_PROGRESS_COLOR: Record<string, string> = {
  succeeded: '#34d399',
  running:   '#60a5fa',
  failed:    '#f87171',
  rejected:  '#fbbf24',
}

export function StageDetail({ stages, artifacts, onSelectArtifact }: StageDetailProps) {
  const activeStage = useMemo(() => {
    if (stages.length === 0) return null
    const running = stages.find(s => s.status === 'running')
    if (running) return running
    return stages[stages.length - 1]
  }, [stages])

  if (!activeStage) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Cpu className="w-6 h-6 text-slate-700" />
          </div>
          <p className="text-sm text-slate-600 font-medium">等待流水线启动</p>
        </div>
      </div>
    )
  }

  const stageDef   = STAGES.find(s => s.key === activeStage.stage_key)
  const stageArts  = artifacts.filter(a => a.stage_key === activeStage.stage_key)
  const st         = activeStage.status
  const cfg        = STATUS_CONFIG[st] ?? STATUS_CONFIG.pending
  const isRunning  = st === 'running'

  return (
    <div className="space-y-4">
      {/* ── Stage header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.15em] mb-1.5">当前阶段</p>
          <h2 className="text-2xl font-bold tracking-tight text-white truncate mb-3" style={{ letterSpacing: '-0.02em' }}>
            {stageDef?.label || activeStage.stage_key}
          </h2>

          <div className="flex items-center flex-wrap gap-2">
            {/* Status pill */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
                style={{ background: cfg.dot, boxShadow: isRunning ? `0 0 6px ${cfg.dot}` : 'none' }}
              />
              {STATUS_CN[st] || st}
            </div>

            {/* Provider */}
            {activeStage.provider && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono text-slate-500"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <Zap className="w-3 h-3 text-violet-400" />
                <span>{activeStage.provider}</span>
              </div>
            )}

            {/* Duration */}
            {activeStage.duration_seconds > 0 && (
              <div className="flex items-center gap-1 text-[11px] font-mono text-slate-600">
                <Clock className="w-3 h-3" />
                <span>{activeStage.duration_seconds}s</span>
              </div>
            )}
          </div>
        </div>

        {/* Attempt badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shrink-0"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <Hash className="w-3 h-3 text-slate-600" />
          <span className="text-[11px] font-mono text-slate-500">第 {activeStage.attempt} 次</span>
        </div>
      </div>

      {/* ── Error ── */}
      {activeStage.error_message && (
        <div className="flex gap-3 p-4 rounded-xl"
          style={{
            background: 'rgba(239,68,68,0.06)',
            borderTop: '1px solid rgba(248,113,113,0.20)',
            borderRight: '1px solid rgba(248,113,113,0.20)',
            borderBottom: '1px solid rgba(248,113,113,0.20)',
            borderLeft: '3px solid rgba(248,113,113,0.7)',
          }}>
          <AlertTriangle className="w-4 h-4 text-[#f87171] shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-[#fca5a5] text-[11px] font-mono leading-relaxed">{activeStage.error_message}</pre>
        </div>
      )}

      {/* ── Artifacts ── */}
      <div>
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.15em] mb-2.5">输出产物</p>
        {stageArts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stageArts.map(artifact => (
              <button
                key={artifact.id}
                onClick={() => onSelectArtifact(artifact)}
                className="group flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
                style={{
                  background: 'rgba(59,130,246,0.06)',
                  border: '1px solid rgba(99,132,255,0.16)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.14)'
                  ;(e.currentTarget as HTMLElement).style.border = '1px solid rgba(99,132,255,0.38)'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 14px rgba(59,130,246,0.18)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.06)'
                  ;(e.currentTarget as HTMLElement).style.border = '1px solid rgba(99,132,255,0.16)'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                }}
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
          <p className="text-xs text-slate-700 italic">暂无产物生成</p>
        )}
      </div>

      {/* ── All stages progress track ── */}
      <div>
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.15em] mb-2.5">全部阶段</p>
        <div className="relative flex gap-1">
          {STAGES.map((s) => {
            const r  = stages.find(sr => sr.stage_key === s.key)
            const rs = r?.status || 'pending'
            const color = STAGE_PROGRESS_COLOR[rs]
            return (
              <div key={s.key} className="flex-1 relative group" title={s.label}>
                {/* Track */}
                <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
                {/* Fill */}
                <div
                  className="absolute inset-0 rounded-full transition-all duration-700"
                  style={{
                    background: color
                      ? `linear-gradient(90deg,${color},${color}cc)`
                      : 'transparent',
                    boxShadow: rs === 'running' ? `0 0 8px ${color}99` : 'none',
                  }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  <div className="bg-slate-800 border border-slate-700 text-slate-200 text-[10px] px-2 py-1 rounded-lg whitespace-nowrap shadow-xl">
                    {s.label}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {/* Stage labels */}
        <div className="flex gap-1 mt-1.5">
          {STAGES.map((s) => {
            const r  = stages.find(sr => sr.stage_key === s.key)
            const rs = r?.status || 'pending'
            return (
              <div key={s.key} className="flex-1 flex justify-center">
                <span
                  className="text-[8px] font-mono truncate text-center"
                  style={{ color: STAGE_PROGRESS_COLOR[rs] ?? '#334155' }}
                >
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
