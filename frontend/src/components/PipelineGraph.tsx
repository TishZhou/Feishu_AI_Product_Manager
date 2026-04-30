import { useMemo } from 'react'
import { STAGES, CHECKPOINT_AFTER } from '../types/api'
import type { StageStatus, RunStatus } from '../types/api'
import type { StageResult } from '../types/api'
import { Check, X, RotateCcw, GitMerge } from 'lucide-react'

interface PipelineGraphProps {
  stages: StageResult[]
  runStatus: RunStatus
}

type NodeItem =
  | { kind: 'stage'; key: string; label: string; index: number; status: StageStatus }
  | { kind: 'checkpoint'; num: number; active: boolean }

function stageColors(status: StageStatus) {
  if (status === 'running')
    return {
      border: 'rgba(51,112,255,0.5)',
      bg: 'linear-gradient(135deg, rgba(51,112,255,0.15) 0%, rgba(51,112,255,0.06) 100%)',
      shadow: '0 0 20px rgba(51,112,255,0.25), inset 0 1px 0 rgba(255,255,255,0.08)',
      badge: 'rgba(51,112,255,0.3)',
      badgeText: '#6699ff',
    }
  if (status === 'succeeded')
    return {
      border: 'rgba(0,180,42,0.4)',
      bg: 'linear-gradient(135deg, rgba(0,180,42,0.12) 0%, rgba(0,180,42,0.05) 100%)',
      shadow: '0 0 12px rgba(0,180,42,0.15)',
      badge: 'rgba(0,180,42,0.3)',
      badgeText: '#00d032',
    }
  if (status === 'failed')
    return {
      border: 'rgba(239,68,68,0.4)',
      bg: 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.05) 100%)',
      shadow: '0 0 12px rgba(239,68,68,0.15)',
      badge: 'rgba(239,68,68,0.3)',
      badgeText: '#f87171',
    }
  if (status === 'rejected')
    return {
      border: 'rgba(245,158,11,0.4)',
      bg: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.05) 100%)',
      shadow: 'none',
      badge: 'rgba(245,158,11,0.3)',
      badgeText: '#fbbf24',
    }
  return {
    border: 'rgba(255,255,255,0.07)',
    bg: 'rgba(255,255,255,0.03)',
    shadow: 'none',
    badge: 'rgba(255,255,255,0.06)',
    badgeText: '#64748b',
  }
}

function ConnectorLine({ status }: { status: StageStatus }) {
  const active = status === 'running'
  const succeeded = status === 'succeeded'
  const color = active
    ? '#3370ff'
    : succeeded
    ? 'rgba(0,180,42,0.5)'
    : 'rgba(51,65,85,0.5)'

  return (
    <div className="flex justify-center my-0.5">
      <div
        className="w-px"
        style={{
          height: 20,
          background: active
            ? `linear-gradient(to bottom, ${color}, ${color})`
            : color,
          opacity: active ? 1 : 0.7,
          boxShadow: active ? `0 0 6px ${color}` : 'none',
        }}
      />
    </div>
  )
}

function DashedLine() {
  return (
    <div className="flex justify-center my-0.5">
      <div
        className="w-px"
        style={{
          height: 16,
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(51,65,85,0.5) 0, rgba(51,65,85,0.5) 4px, transparent 4px, transparent 7px)',
        }}
      />
    </div>
  )
}

function StageNode({
  label,
  status,
  index,
}: {
  label: string
  status: StageStatus
  index: number
}) {
  const c = stageColors(status)
  const isRunning = status === 'running'
  const isSuccess = status === 'succeeded'
  const isFailed = status === 'failed'
  const isRejected = status === 'rejected'
  const isPending = status === 'pending'

  return (
    <div
      className="relative px-3 py-2.5 rounded-xl flex items-center gap-2.5 w-full"
      style={{
        border: `1px solid ${c.border}`,
        background: c.bg,
        boxShadow: c.shadow,
      }}
    >
      {isRunning && (
        <>
          <div className="animate-ping-1 absolute inset-0 rounded-xl border border-[#3370ff] opacity-30 pointer-events-none" />
          <div className="animate-ping-2 absolute inset-0 rounded-xl border border-[#3370ff] opacity-15 pointer-events-none" />
        </>
      )}

      <div
        className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ background: c.badge, color: c.badgeText }}
      >
        {index}
      </div>

      <span
        className={`text-xs font-medium flex-1 ${isPending ? 'text-slate-500' : 'text-white'}`}
      >
        {label}
      </span>

      {isSuccess && <Check className="w-3.5 h-3.5 text-[#00b42a] shrink-0" />}
      {isFailed && <X className="w-3.5 h-3.5 text-[#ef4444] shrink-0" />}
      {isRejected && <RotateCcw className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" />}
      {isRunning && (
        <div className="w-1.5 h-1.5 rounded-full bg-[#3370ff] shrink-0 animate-glow-pulse" />
      )}
    </div>
  )
}

function CheckpointNode({ num, active }: { num: number; active: boolean }) {
  return (
    <div
      className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg w-full"
      style={{
        background: active ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: active ? '0 0 16px rgba(245,158,11,0.25)' : 'none',
      }}
    >
      <GitMerge
        className={`w-3 h-3 ${active ? 'text-[#f59e0b]' : 'text-slate-600'}`}
        style={active ? { filter: 'drop-shadow(0 0 4px rgba(245,158,11,0.6))' } : {}}
      />
      <span
        className={`text-[10px] font-mono ${active ? 'text-[#f59e0b]' : 'text-slate-600'}`}
      >
        检查点 {num}
      </span>
      {active && (
        <div className="absolute inset-0 rounded-lg border border-[#f59e0b] animate-ping-1 opacity-20 pointer-events-none" />
      )}
    </div>
  )
}

export function PipelineGraph({ stages, runStatus }: PipelineGraphProps) {
  const items = useMemo<NodeItem[]>(() => {
    const result: NodeItem[] = []
    STAGES.forEach((stageDef) => {
      const stageResult = stages.find((s) => s.stage_key === stageDef.key)
      const status: StageStatus = stageResult?.status ?? 'pending'
      result.push({ kind: 'stage', key: stageDef.key, label: stageDef.label, index: stageDef.index, status })

      const cpNum = CHECKPOINT_AFTER[stageDef.key]
      if (cpNum) {
        result.push({ kind: 'checkpoint', num: cpNum, active: runStatus === 'waiting_for_approval' })
      }
    })
    return result
  }, [stages, runStatus])

  return (
    <div className="w-full h-full overflow-y-auto px-4 py-4">
      <div className="flex flex-col items-stretch max-w-[220px] mx-auto">
        {items.map((item, i) => {
          const prev = items[i - 1]
          const showConnector = i > 0
          const isDashed = prev?.kind === 'stage' && item.kind === 'checkpoint'
          const prevStatus: StageStatus =
            prev?.kind === 'stage' ? prev.status : 'pending'

          return (
            <div key={item.kind === 'stage' ? item.key : `cp-${item.num}`}>
              {showConnector &&
                (isDashed ? (
                  <DashedLine />
                ) : (
                  <ConnectorLine status={prevStatus} />
                ))}
              {item.kind === 'stage' ? (
                <StageNode label={item.label} status={item.status} index={item.index} />
              ) : (
                <CheckpointNode num={item.num} active={item.active} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
