import { useEffect, useState, useMemo } from 'react'
import { Play, Pause, Square, Activity, Clock, ChevronLeft } from 'lucide-react'
import { useRun, useRunStages, useRunActions, useRunArtifacts, useRunCheckpoints } from '../hooks/useDevFlow'
import { PipelineGraph } from './PipelineGraph'
import { StageDetail } from './StageDetail'
import { LogStream } from './LogStream'
import { CheckpointModal } from './CheckpointModal'
import { ArtifactViewer } from './ArtifactViewer'
import type { Artifact, RunStatus, StageStatus } from '../types/api'

interface ConsoleViewProps {
  runId: string
  onBack: () => void
}

const STATUS_LABEL: Record<RunStatus, string> = {
  created: '已创建', running: '运行中', waiting_for_approval: '待审核',
  paused: '已暂停', completed: '已完成', failed: '已失败', terminated: '已终止',
}

const STATUS_COLOR: Record<RunStatus, { dot: string; text: string; bg: string; border: string; glow: string }> = {
  created:              { dot: '#94a3b8', text: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.20)', glow: 'rgba(148,163,184,0)' },
  running:              { dot: '#60a5fa', text: '#93c5fd', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(99,132,255,0.32)',  glow: 'rgba(59,130,246,0.12)' },
  waiting_for_approval: { dot: '#fbbf24', text: '#fcd34d', bg: 'rgba(245,158,11,0.12)', border: 'rgba(251,191,36,0.32)', glow: 'rgba(245,158,11,0.10)' },
  paused:               { dot: '#94a3b8', text: '#cbd5e1', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.20)', glow: 'rgba(148,163,184,0)' },
  completed:            { dot: '#34d399', text: '#6ee7b7', bg: 'rgba(16,185,129,0.10)', border: 'rgba(52,211,153,0.28)', glow: 'rgba(16,185,129,0.10)' },
  failed:               { dot: '#f87171', text: '#fca5a5', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(248,113,113,0.28)', glow: 'rgba(239,68,68,0.10)' },
  terminated:           { dot: '#f87171', text: '#fca5a5', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(248,113,113,0.28)', glow: 'rgba(239,68,68,0.10)' },
}

const STAGE_STATUS_AMBIENT: Record<string, { from: string; to: string; mid: string }> = {
  running:   { from: 'rgba(37,99,235,0.22)',   mid: 'rgba(99,102,241,0.12)',  to: 'rgba(124,58,237,0.10)' },
  succeeded: { from: 'rgba(5,150,105,0.18)',   mid: 'rgba(16,185,129,0.08)',  to: 'rgba(4,120,87,0.08)'   },
  failed:    { from: 'rgba(185,28,28,0.18)',   mid: 'rgba(239,68,68,0.08)',   to: 'rgba(220,38,38,0.08)'  },
  rejected:  { from: 'rgba(161,98,7,0.18)',    mid: 'rgba(245,158,11,0.08)',  to: 'rgba(180,83,9,0.08)'   },
  pending:   { from: 'rgba(15,23,42,0.8)',     mid: 'rgba(12,18,35,0.8)',     to: 'rgba(8,12,24,0.8)'     },
}

export function ConsoleView({ runId, onBack }: ConsoleViewProps) {
  const { data: run }             = useRun(runId)
  const { data: stages = [] }     = useRunStages(runId)
  const { data: artifacts = [] }  = useRunArtifacts(runId)
  const { data: checkpoints = [] }= useRunCheckpoints(runId)
  const { pause, resume, terminate } = useRunActions()

  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [viewingStageKey, setViewingStageKey]   = useState<string | null>(null)
  const [elapsed, setElapsed]                   = useState(0)

  useEffect(() => {
    if (run?.started_at && !run.completed_at) {
      const start = new Date(run.started_at).getTime()
      const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
      return () => clearInterval(t)
    } else if (run?.completed_at && run?.started_at) {
      setElapsed(Math.floor((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000))
    }
  }, [run?.started_at, run?.completed_at])

  // Auto-clear viewing when a stage becomes active
  useEffect(() => {
    const running = stages.find(s => s.status === 'running')
    if (running && viewingStageKey === running.stage_key) setViewingStageKey(null)
  }, [stages, viewingStageKey])

  const handleStageClick = (key: string) => {
    setViewingStageKey(prev => prev === key ? null : key)
  }

  // Determine the ambient color for the right panel based on the viewed/active stage
  const ambientStatus: string = useMemo(() => {
    const viewedStage = viewingStageKey ? stages.find(s => s.stage_key === viewingStageKey) : null
    if (viewedStage) return viewedStage.status
    const running = stages.find(s => s.status === 'running')
    if (running) return running.status
    const last = stages[stages.length - 1]
    return last?.status ?? 'pending'
  }, [stages, viewingStageKey]) as StageStatus

  const ambient = STAGE_STATUS_AMBIENT[ambientStatus] ?? STAGE_STATUS_AMBIENT.pending

  if (!run) return null

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  const activeCheckpoint = checkpoints.find(c => c.status === 'waiting')
  const showCheckpoint   = run.status === 'waiting_for_approval' && activeCheckpoint
  const stageTotalSecs   = stages.reduce((a, s) => a + (s.duration_seconds || 0), 0)
  const sc               = STATUS_COLOR[run.status]
  const isActive         = ['running', 'paused', 'waiting_for_approval'].includes(run.status)

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: '#080f1c' }}>
      {/* ── Global ambient blobs ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {/* Top-left teal blob */}
        <div className="absolute blob-1" style={{
          width: 600, height: 500, borderRadius: '50%', top: -200, left: -150,
          background: 'radial-gradient(ellipse,rgba(17,94,89,0.22) 0%,transparent 70%)',
          filter: 'blur(40px)',
        }} />
        {/* Top-right blue blob */}
        <div className="absolute blob-2" style={{
          width: 700, height: 600, borderRadius: '50%', top: -250, right: -200,
          background: 'radial-gradient(ellipse,rgba(30,64,175,0.20) 0%,transparent 70%)',
          filter: 'blur(50px)',
        }} />
        {/* Bottom-center purple blob */}
        <div className="absolute" style={{
          width: 500, height: 400, borderRadius: '50%', bottom: -150, left: '35%',
          background: 'radial-gradient(ellipse,rgba(76,29,149,0.16) 0%,transparent 70%)',
          filter: 'blur(60px)',
        }} />
      </div>

      {/* ── Top rainbow line ── */}
      <div className="absolute top-0 inset-x-0 h-[2px] z-30 pointer-events-none"
        style={{ background: 'linear-gradient(90deg,transparent 0%,#3b82f6 20%,#8b5cf6 50%,#06b6d4 80%,transparent 100%)' }} />

      {/* ════════ HEADER ════════ */}
      <header className="h-[52px] shrink-0 relative z-20 flex items-center justify-between px-5 gap-4"
        style={{
          background: 'rgba(8,15,28,0.85)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          boxShadow: `0 1px 0 rgba(59,130,246,0.18), 0 4px 48px rgba(0,0,0,0.6), 0 0 80px ${sc.glow}`,
        }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-200 transition-all"
            style={{ background: 'rgba(255,255,255,0.04)' }}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', boxShadow: '0 0 16px rgba(59,130,246,0.40)' }}>
              <Activity className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[14px] font-bold text-white tracking-tight">DevFlow</span>
            <span className="text-[14px] font-light text-slate-500">Engine</span>
          </div>

          <div className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold"
            style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text }}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${run.status === 'running' ? 'animate-pulse' : ''}`}
              style={{ background: sc.dot, boxShadow: run.status === 'running' ? `0 0 7px ${sc.dot}` : 'none' }} />
            {STATUS_LABEL[run.status]}
            <span className="opacity-40 font-mono ml-0.5">#{run.run_number}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl font-mono text-[11px]"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <Clock className="w-3 h-3 text-slate-500" />
            <span className="tabular-nums text-slate-400">{fmt(elapsed)}</span>
            <div className="h-3 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <span className="tabular-nums text-slate-600">段 {fmt(stageTotalSecs)}</span>
          </div>

          {run.status === 'running' && (
            <button onClick={() => pause.mutate(run.id)} title="暂停"
              className="p-2 rounded-lg text-slate-500 hover:text-white transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          {run.status === 'paused' && (
            <button onClick={() => resume.mutate(run.id)} title="继续" className="p-2 rounded-lg transition-all"
              style={{ background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(99,132,255,0.32)', color: '#60a5fa' }}>
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {isActive && (
            <button onClick={() => terminate.mutate(run.id)} title="终止" className="p-2 rounded-lg transition-all"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(248,113,113,0.24)', color: '#f87171' }}>
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* ════════ BODY ════════ */}
      <div className="flex-1 flex overflow-hidden relative z-10">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-[268px] shrink-0 flex flex-col relative"
          style={{
            background: 'linear-gradient(180deg,rgba(10,18,36,0.96) 0%,rgba(6,11,22,0.98) 100%)',
            borderRight: '1px solid rgba(255,255,255,0.07)',
          }}>
          {/* Sidebar header */}
          <div className="px-4 pt-4 pb-3 shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[9px] font-bold uppercase tracking-[0.20em] text-slate-600 mb-2.5">流水线进度</p>
            <div className="flex gap-1">
              {stages.map(s => (
                <div key={s.stage_key} className="h-[3px] flex-1 rounded-full transition-all duration-500"
                  style={{
                    background:
                      s.status === 'succeeded' ? 'linear-gradient(90deg,#34d399,#10b981)' :
                      s.status === 'running'   ? 'linear-gradient(90deg,#60a5fa,#818cf8)' :
                      s.status === 'failed'    ? '#f87171' : 'rgba(255,255,255,0.08)',
                    boxShadow: s.status === 'running' ? '0 0 8px rgba(99,132,255,0.7)' : 'none',
                  }} />
              ))}
            </div>
          </div>

          {/* Hint label */}
          {stages.some(s => s.status === 'succeeded' || s.status === 'failed') && (
            <div className="px-4 py-1.5 shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <p className="text-[9px] text-slate-700">点击已完成阶段可查看详情</p>
            </div>
          )}

          <PipelineGraph
            stages={stages}
            runStatus={run.status}
            selectedStageKey={viewingStageKey}
            onStageClick={handleStageClick}
          />
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative">

          {/* Right panel ambient background */}
          <div className="absolute inset-0 pointer-events-none transition-all duration-1000"
            style={{
              background: `
                radial-gradient(ellipse 70% 55% at 90% 0%, ${ambient.from} 0%, transparent 65%),
                radial-gradient(ellipse 50% 70% at 5% 100%, ${ambient.to} 0%, transparent 65%),
                radial-gradient(ellipse 60% 40% at 50% 50%, ${ambient.mid} 0%, transparent 70%),
                linear-gradient(180deg,#0d1929 0%,#080f1c 100%)
              `,
            }} />

          {/* Subtle dot grid */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.35]"
            style={{
              backgroundImage: 'radial-gradient(circle,rgba(255,255,255,0.15) 1px,transparent 1px)',
              backgroundSize: '28px 28px',
            }} />

          {/* Stage detail area */}
          <div className="relative flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-4">
            <StageDetail
              stages={stages}
              artifacts={artifacts}
              onSelectArtifact={setSelectedArtifact}
              viewingStageKey={viewingStageKey}
              onClearViewing={() => setViewingStageKey(null)}
            />
          </div>

          {/* Divider with glow */}
          <div className="relative shrink-0 z-10" style={{ height: 1 }}>
            <div className="absolute inset-x-0 top-0 h-px"
              style={{ background: 'rgba(255,255,255,0.07)' }} />
            <div className="absolute inset-x-0 top-0 h-px"
              style={{ background: `linear-gradient(90deg,transparent,${ambient.from},transparent)` }} />
            <div className="absolute inset-x-0 -top-3 h-6 pointer-events-none"
              style={{ background: `linear-gradient(0deg,rgba(8,15,28,0.6),transparent)` }} />
          </div>

          {/* Log stream */}
          <div className="shrink-0 relative z-10" style={{ height: '42%' }}>
            <LogStream stages={stages} runStatus={run.status} runId={runId} />
          </div>
        </div>
      </div>

      {showCheckpoint && (
        <CheckpointModal checkpoint={activeCheckpoint} artifacts={artifacts} />
      )}
      <ArtifactViewer artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
    </div>
  )
}
