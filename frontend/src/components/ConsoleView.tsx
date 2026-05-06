import { useEffect, useState } from 'react'
import { Play, Pause, Square, Activity, Clock, ChevronLeft, RotateCcw, CheckCircle2 } from 'lucide-react'
import {
  useRun,
  useRunStages,
  useRunActions,
  useRunArtifacts,
  useRunCheckpoints,
  useSourceApplicationStatus,
  useRollbackRun,
} from '../hooks/useDevFlow'
import { PipelineGraph } from './PipelineGraph'
import { StageDetail } from './StageDetail'
import { LogStream } from './LogStream'
import { CheckpointModal } from './CheckpointModal'
import { ClarificationModal } from './ClarificationModal'
import { ArtifactViewer } from './ArtifactViewer'
import { TestProgressWindow } from './TestProgressWindow'
import { STAGES } from '../types/api'
import type { Artifact, RunStatus, StageResult } from '../types/api'

interface ConsoleViewProps {
  runId: string
  onBack: () => void
}

const STATUS_LABEL: Record<RunStatus, string> = {
  created: '已创建', running: '运行中', waiting_for_approval: '待审核',
  waiting_for_clarification: '待澄清',
  paused: '已暂停', completed: '已完成', failed: '已失败', terminated: '已终止',
}

const STATUS_DOT: Record<RunStatus, string> = {
  created:              '#94a3b8',
  running:              '#60a5fa',
  waiting_for_approval: '#fbbf24',
  waiting_for_clarification: '#fbbf24',
  paused:               '#94a3b8',
  completed:            '#34d399',
  failed:               '#f87171',
  terminated:           '#f87171',
}

/* Very-subtle right-panel tint per active stage — not overwhelming */
const STAGE_TINT: Record<string, string> = {
  running:   'rgba(37,99,235,0.12)',
  succeeded: 'rgba(5,150,105,0.08)',
  failed:    'rgba(185,28,28,0.08)',
  rejected:  'rgba(161,98,7,0.07)',
  pending:   'transparent',
}

function latestStageForKey<T extends { stage_key: string; attempt: number }>(stages: T[], key: string) {
  return stages
    .filter(stage => stage.stage_key === key)
    .sort((a, b) => b.attempt - a.attempt)[0]
}

function isStageResult(stage: StageResult | undefined): stage is StageResult {
  return !!stage
}

export function ConsoleView({ runId, onBack }: ConsoleViewProps) {
  const { data: run }             = useRun(runId)
  const { data: stages = [] }     = useRunStages(runId)
  const { data: artifacts = [] }  = useRunArtifacts(runId)
  const { data: checkpoints = [] }= useRunCheckpoints(runId)
  const { data: sourceApp }       = useSourceApplicationStatus(runId)
  const rollback                  = useRollbackRun()
  const { pause, resume, terminate } = useRunActions()

  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [viewingStageKey, setViewingStageKey]   = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (run?.started_at && !run.completed_at) {
      const start = new Date(run.started_at).getTime()
      const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
      return () => clearInterval(t)
    }
  }, [run?.started_at, run?.completed_at])

  const handleStageClick = (key: string) => {
    setViewingStageKey(prev => prev === key ? null : key)
  }

  const progressStages = STAGES.map(stage => latestStageForKey(stages, stage.key)).filter(isStageResult)
  const runningStage = progressStages.find(s => s.status === 'running')
  const selectedStageKey = runningStage?.stage_key === viewingStageKey ? null : viewingStageKey

  const activeStageTint = (() => {
    const viewed = selectedStageKey ? latestStageForKey(stages, selectedStageKey) : null
    if (viewed) return STAGE_TINT[viewed.status] ?? 'transparent'
    if (runningStage) return STAGE_TINT.running
    const last = [...progressStages].reverse().find(s => s.status !== 'pending')
    return STAGE_TINT[last?.status ?? 'pending'] ?? 'transparent'
  })()

  if (!run) return null

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
  const displayElapsed = run.completed_at && run.started_at
    ? Math.floor((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
    : elapsed

  const activeCheckpoint = checkpoints.find(c => c.status === 'waiting')
  const showCheckpoint   = run.status === 'waiting_for_approval' && activeCheckpoint
  const isActive         = ['running', 'paused', 'waiting_for_approval', 'waiting_for_clarification'].includes(run.status)
  const stageTotalSecs   = stages.reduce((a, s) => a + (s.duration_seconds || 0), 0)
  const dot              = STATUS_DOT[run.status]

  return (
    /* ── Outermost: rich blue scene ── */
    <div className="h-screen w-screen flex flex-col overflow-hidden relative"
      style={{
        background: [
          'radial-gradient(ellipse 100% 55% at 40% -5%, rgba(37,99,235,0.60) 0%, transparent 60%)',
          'radial-gradient(ellipse 70% 70% at 95% 105%, rgba(79,70,229,0.32) 0%, transparent 55%)',
          'radial-gradient(ellipse 50% 45% at -5% 60%, rgba(13,148,136,0.18) 0%, transparent 55%)',
          'radial-gradient(ellipse 80% 50% at 50% 50%, rgba(10,30,80,0.55) 0%, transparent 80%)',
          '#071525',
        ].join(','),
      }}>

      {/* Dot grid overlay */}
      <div className="dot-grid absolute inset-0 pointer-events-none opacity-40 z-0" />

      {/* Rainbow top accent line */}
      <div className="absolute top-0 inset-x-0 h-[2px] z-30 pointer-events-none"
        style={{ background: 'linear-gradient(90deg,transparent,#3b82f6 20%,#8b5cf6 50%,#06b6d4 80%,transparent)' }} />

      {/* ════ HEADER ════ */}
      <header className="glass-panel h-[52px] shrink-0 relative z-20 flex items-center justify-between px-5 gap-4"
        style={{ borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderRadius: 0 }}>

        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-close p-1.5 rounded-lg">
            <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#2563eb,#7c3aed)', boxShadow: '0 0 18px rgba(79,142,255,0.50)' }}>
              <Activity className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[14px] font-bold text-white">DevFlow</span>
            <span className="text-[14px] font-light text-blue-400/60">Engine</span>
          </div>

          <div className="h-5 w-px bg-white/10" />

          {/* Status badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold glass-card"
            style={{ borderRadius: 9999 }}>
            <span className={`w-1.5 h-1.5 rounded-full ${run.status === 'running' ? 'animate-pulse' : ''}`}
              style={{ background: dot, boxShadow: run.status === 'running' ? `0 0 7px ${dot}` : 'none' }} />
            <span style={{ color: dot }}>{STATUS_LABEL[run.status]}</span>
            <span className="text-white/20 font-mono ml-0.5">#{run.run_number}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Timer */}
          <div className="glass-card flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl font-mono text-[11px]"
            style={{ borderRadius: 12 }}>
            <Clock className="w-3 h-3 text-blue-400/70" />
            <span className="tabular-nums text-blue-100">{fmt(displayElapsed)}</span>
            <div className="h-3 w-px bg-white/10" />
            <span className="tabular-nums text-blue-400/40">{fmt(stageTotalSecs)}</span>
          </div>

          {run.status === 'running' && (
            <button onClick={() => pause.mutate(run.id)}
              className="glass-card p-2 rounded-lg transition-all" style={{ borderRadius: 10 }}>
              <Pause className="w-3.5 h-3.5 text-blue-300" />
            </button>
          )}
          {run.status === 'paused' && (
            <button onClick={() => resume.mutate(run.id)}
              className="p-2 rounded-lg transition-all"
              style={{ background: 'rgba(37,99,235,0.22)', border: '1px solid rgba(99,162,255,0.35)', borderRadius: 10 }}>
              <Play className="w-3.5 h-3.5 text-blue-300" />
            </button>
          )}
          {isActive && (
            <button onClick={() => terminate.mutate(run.id)}
              className="p-2 rounded-lg transition-all"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(248,113,113,0.24)', borderRadius: 10 }}>
              <Square className="w-3.5 h-3.5 text-red-400" />
            </button>
          )}
        </div>
      </header>

      {/* Source-application banner — visible after delivery applied to source */}
      {sourceApp?.applied && (
        <div
          className="shrink-0 relative z-20 px-5 py-2.5 flex items-center justify-between gap-4 text-[12px]"
          style={{
            background: sourceApp.rolled_back
              ? 'linear-gradient(90deg, rgba(100,116,139,0.18), rgba(71,85,105,0.10))'
              : 'linear-gradient(90deg, rgba(16,185,129,0.18), rgba(5,150,105,0.10))',
            borderBottom: sourceApp.rolled_back
              ? '1px solid rgba(148,163,184,0.25)'
              : '1px solid rgba(16,185,129,0.32)',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {sourceApp.rolled_back ? (
              <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span className={sourceApp.rolled_back ? 'text-slate-300' : 'text-emerald-200'}>
              {sourceApp.rolled_back ? '已撤回' : '已应用到源仓库'}
            </span>
            <span className="text-slate-400/80 truncate font-mono text-[11px]">
              {sourceApp.source_repo}
            </span>
            {!!sourceApp.files?.length && (
              <span className="text-slate-400/70 text-[11px]">· {sourceApp.files.length} 个文件</span>
            )}
          </div>
          {!sourceApp.rolled_back && (
            <button
              onClick={() => {
                if (!run) return
                if (!confirm(`将恢复 ${sourceApp.files?.length ?? 0} 个文件到 apply 之前的状态。继续？`)) return
                rollback.mutate(run.id)
              }}
              disabled={rollback.isPending}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-60"
              style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.12)', color: '#fcd34d' }}
            >
              <RotateCcw className="w-3 h-3" />
              {rollback.isPending ? '撤回中...' : '撤回应用'}
            </button>
          )}
        </div>
      )}

      {/* ════ BODY ════ */}
      <div className="flex-1 flex overflow-hidden relative z-10">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-[268px] shrink-0 flex flex-col glass-panel"
          style={{ borderTop: 'none', borderBottom: 'none', borderLeft: 'none', borderRadius: 0 }}>

          {/* Sidebar header */}
          <div className="px-4 pt-4 pb-3 shrink-0 border-b border-white/5">
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-blue-400/50 mb-2.5">流水线阶段</p>
            {/* Mini progress bar */}
            <div className="flex gap-[3px]">
              {progressStages.map(s => (
                <div key={s.stage_key} className="h-[3px] flex-1 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: s.status !== 'pending' ? '100%' : '0%',
                      background:
                        s.status === 'succeeded' ? 'linear-gradient(90deg,#34d399,#10b981)' :
                        s.status === 'running'   ? 'linear-gradient(90deg,#60a5fa,#818cf8)' :
                        s.status === 'failed'    ? '#f87171' : 'transparent',
                      boxShadow: s.status === 'running' ? '0 0 8px rgba(99,132,255,0.8)' : 'none',
                    }} />
                </div>
              ))}
            </div>
          </div>

          {stages.some(s => ['succeeded','failed','rejected'].includes(s.status)) && (
            <div className="px-4 py-1.5 border-b border-white/[0.04] shrink-0">
              <p className="text-[9px] text-blue-400/35">点击已完成阶段可查看详情</p>
            </div>
          )}

          <PipelineGraph
            stages={stages}
            runStatus={run.status}
            selectedStageKey={selectedStageKey}
            onStageClick={handleStageClick}
          />
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative">

          {/* Subtle stage-status tint overlay */}
          <div className="absolute inset-0 pointer-events-none z-0 transition-all duration-1000"
            style={{ background: activeStageTint }} />

          {/* Stage detail scroll area */}
          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-4">
            <StageDetail
              stages={stages}
              artifacts={artifacts}
              onSelectArtifact={setSelectedArtifact}
              viewingStageKey={selectedStageKey}
              onClearViewing={() => setViewingStageKey(null)}
            />
          </div>

          {/* Glowing divider */}
          <div className="relative shrink-0 z-10" style={{ height: 1 }}>
            <div className="absolute inset-x-0 top-0 h-px bg-white/[0.06]" />
            <div className="absolute inset-x-0 top-0 h-px"
              style={{ background: 'linear-gradient(90deg,transparent,rgba(79,142,255,0.35),transparent)' }} />
          </div>

          {/* Log stream */}
          <div className="shrink-0 relative z-10" style={{ height: '42%' }}>
            <LogStream stages={stages} runStatus={run.status} runId={runId} />
          </div>

          <TestProgressWindow runId={runId} stages={stages} />
        </div>
      </div>

      {showCheckpoint && <CheckpointModal checkpoint={activeCheckpoint} artifacts={artifacts} />}
      {run.status === 'waiting_for_clarification' && <ClarificationModal runId={runId} />}
      <ArtifactViewer artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
    </div>
  )
}
