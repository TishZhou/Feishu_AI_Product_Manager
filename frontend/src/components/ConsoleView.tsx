import { useEffect, useState } from 'react'
import { Play, Pause, Square, Activity, Clock, ChevronLeft } from 'lucide-react'
import { useRun, useRunStages, useRunActions, useRunArtifacts, useRunCheckpoints } from '../hooks/useDevFlow'
import { PipelineGraph } from './PipelineGraph'
import { StageDetail } from './StageDetail'
import { LogStream } from './LogStream'
import { CheckpointModal } from './CheckpointModal'
import { ArtifactViewer } from './ArtifactViewer'
import type { Artifact, RunStatus } from '../types/api'

interface ConsoleViewProps {
  runId: string
  onBack: () => void
}

const STATUS_LABEL: Record<RunStatus, string> = {
  created:              '已创建',
  running:              '运行中',
  waiting_for_approval: '待审核',
  paused:               '已暂停',
  completed:            '已完成',
  failed:               '已失败',
  terminated:           '已终止',
}

const STATUS_COLOR: Record<RunStatus, { dot: string; text: string; bg: string; border: string }> = {
  created:              { dot: '#94a3b8', text: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.20)' },
  running:              { dot: '#60a5fa', text: '#93c5fd', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(99,132,255,0.28)' },
  waiting_for_approval: { dot: '#fbbf24', text: '#fcd34d', bg: 'rgba(245,158,11,0.12)', border: 'rgba(251,191,36,0.28)' },
  paused:               { dot: '#94a3b8', text: '#cbd5e1', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.18)' },
  completed:            { dot: '#34d399', text: '#6ee7b7', bg: 'rgba(16,185,129,0.10)', border: 'rgba(52,211,153,0.25)' },
  failed:               { dot: '#f87171', text: '#fca5a5', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(248,113,113,0.25)' },
  terminated:           { dot: '#f87171', text: '#fca5a5', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(248,113,113,0.25)' },
}

export function ConsoleView({ runId, onBack }: ConsoleViewProps) {
  const { data: run }             = useRun(runId)
  const { data: stages = [] }     = useRunStages(runId)
  const { data: artifacts = [] }  = useRunArtifacts(runId)
  const { data: checkpoints = [] }= useRunCheckpoints(runId)
  const { pause, resume, terminate } = useRunActions()

  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (run?.started_at && !run.completed_at) {
      const start = new Date(run.started_at).getTime()
      const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
      return () => clearInterval(interval)
    } else if (run?.completed_at && run?.started_at) {
      setElapsed(Math.floor((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000))
    }
  }, [run?.started_at, run?.completed_at])

  if (!run) return null

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  const activeCheckpoint  = checkpoints.find(c => c.status === 'waiting')
  const showCheckpoint    = run.status === 'waiting_for_approval' && activeCheckpoint
  const stageTotalSecs    = stages.reduce((a, s) => a + (s.duration_seconds || 0), 0)
  const sc                = STATUS_COLOR[run.status]
  const isActive          = ['running', 'paused', 'waiting_for_approval'].includes(run.status)

  return (
    <div className="h-screen w-screen flex flex-col bg-[#020817] overflow-hidden">
      {/* ── Top ambient line ── */}
      <div className="absolute top-0 inset-x-0 h-px z-20"
        style={{ background: 'linear-gradient(90deg,transparent 0%,rgba(99,132,255,0.7) 30%,rgba(167,139,250,0.5) 60%,transparent 100%)' }} />

      {/* ══════════════════════ HEADER ══════════════════════ */}
      <header
        className="h-13 shrink-0 relative z-10 flex items-center justify-between px-4"
        style={{
          height: 52,
          background: 'rgba(2,8,23,0.92)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 1px 0 rgba(99,132,255,0.15), 0 4px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Left group */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-slate-600 hover:text-slate-300 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div
            className="p-1.5 rounded-lg"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(99,132,255,0.25)' }}
          >
            <Activity className="w-3.5 h-3.5 text-[#60a5fa]" />
          </div>

          <span className="text-[13px] font-semibold text-white tracking-tight">DevFlow Engine</span>

          <div className="h-4 w-px bg-white/8" />

          {/* Status pill */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${run.status === 'running' ? 'animate-pulse' : ''}`}
              style={{ background: sc.dot, boxShadow: run.status === 'running' ? `0 0 6px ${sc.dot}` : 'none' }}
            />
            {STATUS_LABEL[run.status]}
            <span className="opacity-50 font-mono">#{run.run_number}</span>
          </div>
        </div>

        {/* Right group */}
        <div className="flex items-center gap-2">
          {/* Timer */}
          <div
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl font-mono text-[11px]"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center gap-1.5 text-slate-400">
              <Clock className="w-3 h-3" />
              <span className="tabular-nums">{fmt(elapsed)}</span>
            </div>
            <div className="h-3 w-px bg-white/8" />
            <span className="text-slate-600 tabular-nums">阶段 {fmt(stageTotalSecs)}</span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1">
            {run.status === 'running' && (
              <button
                onClick={() => pause.mutate(run.id)}
                title="暂停"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-200 transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
            {run.status === 'paused' && (
              <button
                onClick={() => resume.mutate(run.id)}
                title="继续"
                className="p-2 rounded-lg transition-all"
                style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(99,132,255,0.30)', color: '#60a5fa' }}
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            {isActive && (
              <button
                onClick={() => terminate.mutate(run.id)}
                title="终止"
                className="p-2 rounded-lg transition-all"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(248,113,113,0.22)', color: '#f87171' }}
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ══════════════════════ BODY ══════════════════════ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left sidebar ── */}
        <div
          className="w-[272px] shrink-0 flex flex-col"
          style={{
            background: 'linear-gradient(180deg,rgba(5,10,26,0.90) 0%,rgba(2,8,23,0.95) 100%)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRight: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {/* Sidebar header */}
          <div className="px-4 pt-4 pb-3 shrink-0 flex items-center gap-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex gap-1">
              {stages.map((s) => (
                <div
                  key={s.stage_key}
                  className="h-0.5 w-4 rounded-full transition-all duration-500"
                  style={{
                    background:
                      s.status === 'succeeded' ? '#34d399' :
                      s.status === 'running'   ? '#60a5fa' :
                      s.status === 'failed'    ? '#f87171' : 'rgba(255,255,255,0.1)',
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.16em] ml-1">
              流水线进度
            </p>
          </div>
          <PipelineGraph stages={stages} runStatus={run.status} />
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stage detail */}
          <div
            className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <StageDetail stages={stages} artifacts={artifacts} onSelectArtifact={setSelectedArtifact} />
          </div>

          {/* Log stream */}
          <div className="h-[42%] shrink-0"
            style={{ background: 'rgba(0,0,0,0.40)' }}>
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
