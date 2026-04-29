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
  created: '已创建',
  running: '运行中',
  waiting_for_approval: '待审核',
  paused: '已暂停',
  completed: '已完成',
  failed: '已失败',
  terminated: '已终止',
}

const STATUS_STYLE: Record<RunStatus, string> = {
  created: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  running: 'bg-[#3370ff]/15 text-[#6699ff] border-[#3370ff]/30',
  waiting_for_approval: 'bg-[#f59e0b]/15 text-[#f59e0b] border-[#f59e0b]/30',
  paused: 'bg-slate-400/15 text-slate-300 border-slate-400/30',
  completed: 'bg-[#00b42a]/15 text-[#00d032] border-[#00b42a]/30',
  failed: 'bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/30',
  terminated: 'bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/30',
}

const STATUS_DOT: Record<RunStatus, string> = {
  created: 'bg-slate-400',
  running: 'bg-[#3370ff] animate-pulse',
  waiting_for_approval: 'bg-[#f59e0b] animate-pulse',
  paused: 'bg-slate-400',
  completed: 'bg-[#00b42a]',
  failed: 'bg-[#ef4444]',
  terminated: 'bg-[#ef4444]',
}

export function ConsoleView({ runId, onBack }: ConsoleViewProps) {
  const { data: run } = useRun(runId)
  const { data: stages = [] } = useRunStages(runId)
  const { data: artifacts = [] } = useRunArtifacts(runId)
  const { data: checkpoints = [] } = useRunCheckpoints(runId)

  const { pause, resume, terminate } = useRunActions()

  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (run?.started_at && !run.completed_at) {
      const start = new Date(run.started_at).getTime()
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    } else if (run?.completed_at && run?.started_at) {
      setElapsed(Math.floor((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000))
    }
  }, [run?.started_at, run?.completed_at])

  if (!run) return null

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const activeCheckpoint = checkpoints.find(c => c.status === 'waiting')
  const showCheckpointModal = run.status === 'waiting_for_approval' && activeCheckpoint
  const totalStageDuration = stages.reduce((acc, s) => acc + (s.duration_seconds || 0), 0)

  return (
    <div className="h-screen w-screen flex flex-col bg-[#030712] overflow-hidden bg-grid">
      {/* Ambient top glow */}
      <div className="absolute top-0 left-0 right-0 h-[1px] z-20"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(51,112,255,0.6), rgba(124,58,237,0.4), transparent)' }} />

      {/* Header */}
      <header className="h-14 shrink-0 relative z-10 flex items-center justify-between px-5"
        style={{
          background: 'linear-gradient(180deg, rgba(3,7,18,0.95) 0%, rgba(3,7,18,0.85) 100%)',
          backdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 1px 0 rgba(51,112,255,0.12), 0 4px 20px rgba(0,0,0,0.4)',
        }}
      >
        {/* Left */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-slate-500 hover:text-white transition-colors mr-1 group"
          >
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          </button>

          <div className="p-1.5 rounded-lg"
            style={{ background: 'rgba(51,112,255,0.15)', border: '1px solid rgba(51,112,255,0.25)' }}>
            <Activity className="w-4 h-4 text-[#3370ff]" />
          </div>

          <span className="text-sm font-semibold text-white tracking-tight">DevFlow Engine</span>

          <div className="w-px h-4 bg-white/10 mx-1" />

          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono ${STATUS_STYLE[run.status]}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[run.status]}`} />
            {STATUS_LABEL[run.status]}
            <span className="text-current/50 ml-1">#{run.run_number}</span>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 font-mono text-xs text-slate-500 px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-1.5 text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatTime(elapsed)}</span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            <div className="text-slate-500">阶段 {formatTime(totalStageDuration)}</div>
          </div>

          <div className="flex items-center gap-1.5">
            {run.status === 'running' && (
              <button
                onClick={() => pause.mutate(run.id)}
                title="暂停"
                className="p-2 rounded-lg text-slate-400 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
            {run.status === 'paused' && (
              <button
                onClick={() => resume.mutate(run.id)}
                title="继续"
                className="p-2 rounded-lg text-[#3370ff] hover:text-white transition-colors"
                style={{ background: 'rgba(51,112,255,0.15)', border: '1px solid rgba(51,112,255,0.25)' }}
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            {['running', 'paused', 'waiting_for_approval'].includes(run.status) && (
              <button
                onClick={() => terminate.mutate(run.id)}
                title="终止"
                className="p-2 rounded-lg text-[#ef4444] hover:text-white transition-colors"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left panel: pipeline graph */}
        <div className="w-[300px] shrink-0 flex flex-col relative z-0"
          style={{
            background: 'rgba(0,0,0,0.25)',
            borderRight: '1px solid rgba(255,255,255,0.05)',
          }}>
          <div className="px-4 pt-4 pb-2">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">流水线进度</p>
          </div>
          <PipelineGraph stages={stages} runStatus={run.status} />
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col relative z-0 overflow-hidden">
          {/* Stage detail */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <StageDetail stages={stages} artifacts={artifacts} onSelectArtifact={setSelectedArtifact} />
          </div>

          {/* Log stream */}
          <div className="h-[44%] shrink-0"
            style={{ background: 'rgba(0,0,0,0.3)' }}>
            <LogStream stages={stages} runStatus={run.status} runId={runId} />
          </div>
        </div>
      </div>

      {showCheckpointModal && (
        <CheckpointModal checkpoint={activeCheckpoint} artifacts={artifacts} />
      )}

      <ArtifactViewer
        artifact={selectedArtifact}
        onClose={() => setSelectedArtifact(null)}
      />
    </div>
  )
}
