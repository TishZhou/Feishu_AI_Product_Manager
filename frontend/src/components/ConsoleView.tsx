import { useEffect, useState } from 'react'
import { Play, Pause, Square, Activity, Clock } from 'lucide-react'
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

const statusColors: Record<RunStatus, string> = {
  created: 'bg-slate-500',
  running: 'bg-[#3370ff] animate-pulse',
  waiting_for_approval: 'bg-[#f59e0b]',
  paused: 'bg-slate-400',
  completed: 'bg-[#00b42a]',
  failed: 'bg-[#ef4444]',
  terminated: 'bg-[#ef4444]'
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
    <div className="h-screen w-screen flex flex-col bg-slate-950 overflow-hidden">
      {/* Header */}
      <header className="h-16 shrink-0 bg-white/5 backdrop-blur-md border-b border-white/10 px-6 flex items-center justify-between z-10 relative">
        <div className="flex items-center gap-4">
          <Activity className="w-5 h-5 text-[#3370ff]" />
          <h1 className="text-lg font-semibold text-white tracking-tight">DevFlow Engine</h1>
          <div className="h-4 w-px bg-white/10 mx-2" />
          <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full border border-white/5">
            <div className={`w-2 h-2 rounded-full ${statusColors[run.status]}`} />
            <span className="text-xs font-mono text-slate-300 uppercase">Run #{run.run_number}</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 font-mono text-xs text-slate-400 bg-black/40 px-4 py-2 rounded-lg border border-white/5">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>Elapsed: {formatTime(elapsed)}</span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            <div>Stages: {formatTime(totalStageDuration)}</div>
          </div>

          <div className="flex items-center gap-2">
            {run.status === 'running' && (
              <button onClick={() => pause.mutate(run.id)} className="p-2 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors" title="Pause">
                <Pause className="w-4 h-4" />
              </button>
            )}
            {run.status === 'paused' && (
              <button onClick={() => resume.mutate(run.id)} className="p-2 bg-[#3370ff]/20 hover:bg-[#3370ff]/30 text-[#3370ff] rounded-lg transition-colors" title="Resume">
                <Play className="w-4 h-4" />
              </button>
            )}
            {['running', 'paused', 'waiting_for_approval'].includes(run.status) && (
              <button onClick={() => terminate.mutate(run.id)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors" title="Terminate">
                <Square className="w-4 h-4" />
              </button>
            )}
            <button onClick={onBack} className="ml-4 text-xs text-slate-400 hover:text-white transition-colors">Exit</button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Graph */}
        <div className="w-1/3 border-r border-white/10 bg-black/20 flex flex-col relative z-0">
          <PipelineGraph stages={stages} runStatus={run.status} />
        </div>

        {/* Right Panel */}
        <div className="w-2/3 flex flex-col relative z-0">
          <div className="h-1/2 border-b border-white/10 p-6 overflow-y-auto">
            <StageDetail stages={stages} artifacts={artifacts} onSelectArtifact={setSelectedArtifact} />
          </div>
          <div className="h-1/2 bg-black/40">
            <LogStream stages={stages} runStatus={run.status} />
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
