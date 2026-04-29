import { useMemo } from 'react'
import type { StageResult, Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { FileCode2, Clock, Cpu, AlertTriangle } from 'lucide-react'

interface StageDetailProps {
  stages: StageResult[]
  artifacts: Artifact[]
  onSelectArtifact: (artifact: Artifact) => void
}

export function StageDetail({ stages, artifacts, onSelectArtifact }: StageDetailProps) {
  const activeStage = useMemo(() => {
    if (stages.length === 0) return null
    // Find running stage, or the last completed/failed
    const running = stages.find(s => s.status === 'running')
    if (running) return running
    return stages[stages.length - 1]
  }, [stages])

  if (!activeStage) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        No active stage
      </div>
    )
  }

  const stageDef = STAGES.find(s => s.key === activeStage.stage_key)
  const stageArtifacts = artifacts.filter(a => a.stage_key === activeStage.stage_key)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">{stageDef?.label || activeStage.stage_key}</h2>
          <div className="flex items-center gap-4 mt-2">
            <span className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium ${
              activeStage.status === 'running' ? 'bg-[#3370ff]/20 text-[#3370ff] border border-[#3370ff]/30' :
              activeStage.status === 'succeeded' ? 'bg-[#00b42a]/20 text-[#00b42a] border border-[#00b42a]/30' :
              activeStage.status === 'failed' ? 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30' :
              'bg-slate-800 text-slate-300 border border-slate-700'
            }`}>
              {activeStage.status.toUpperCase()}
            </span>
            <div className="text-xs text-slate-400 font-mono flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" /> {activeStage.provider} / {activeStage.model}
            </div>
            <div className="text-xs text-slate-400 font-mono flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {activeStage.duration_seconds}s
            </div>
          </div>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          Attempt {activeStage.attempt}
        </div>
      </div>

      {activeStage.error_message && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 font-mono text-sm flex gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <pre className="whitespace-pre-wrap">{activeStage.error_message}</pre>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Output Artifacts</h3>
        {stageArtifacts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stageArtifacts.map(artifact => (
              <button
                key={artifact.id}
                onClick={() => onSelectArtifact(artifact)}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors text-sm font-mono text-slate-300"
              >
                <FileCode2 className="w-4 h-4 text-[#3370ff]" />
                {artifact.filename}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">No artifacts generated yet.</p>
        )}
      </div>
    </div>
  )
}
