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
      border: 'rgba(99,141,255,0.55)',
      bg: 'linear-gradient(135deg, rgba(51,112,255,0.22) 0%, rgba(91,142,255,0.12) 50%, rgba(51,112,255,0.08) 100%)',
      badge: 'rgba(51,112,255,0.35)',
      badgeText: '#93b4ff',
      labelColor: '#e8edff',
    }
  if (status === 'succeeded')
    return {
      border: 'rgba(0,200,60,0.38)',
      bg: 'linear-gradient(135deg, rgba(0,180,42,0.16) 0%, rgba(0,210,70,0.07) 100%)',
      badge: 'rgba(0,180,42,0.28)',
      badgeText: '#4dde7a',
      labelColor: '#d4fce1',
    }
  if (status === 'failed')
    return {
      border: 'rgba(239,68,68,0.38)',
      bg: 'linear-gradient(135deg, rgba(239,68,68,0.16) 0%, rgba(239,68,68,0.07) 100%)',
      badge: 'rgba(239,68,68,0.28)',
      badgeText: '#fca5a5',
      labelColor: '#ffe4e4',
    }
  if (status === 'rejected')
    return {
      border: 'rgba(245,158,11,0.38)',
      bg: 'linear-gradient(135deg, rgba(245,158,11,0.16) 0%, rgba(245,158,11,0.07) 100%)',
      badge: 'rgba(245,158,11,0.28)',
      badgeText: '#fcd34d',
      labelColor: '#fff3cd',
    }
  return {
    border: 'rgba(255,255,255,0.07)',
    bg: 'rgba(255,255,255,0.03)',
    badge: 'rgba(255,255,255,0.06)',
    badgeText: '#475569',
    labelColor: '#475569',
  }
}

function ConnectorLine({ status }: { status: StageStatus }) {
  const isRunning = status === 'running'
  const isSucceeded = status === 'succeeded'

  return (
    <div className="flex justify-center" style={{ margin: '2px 0' }}>
      <div
        style={{
          width: 1.5,
          height: 18,
          borderRadius: 2,
          background: isRunning
            ? 'linear-gradient(to bottom, rgba(99,141,255,0.9), rgba(51,112,255,0.4))'
            : isSucceeded
            ? 'linear-gradient(to bottom, rgba(0,200,60,0.6), rgba(0,180,42,0.2))'
            : 'rgba(51,65,85,0.35)',
          boxShadow: isRunning
            ? '0 0 6px rgba(51,112,255,0.5)'
            : isSucceeded
            ? '0 0 4px rgba(0,180,42,0.3)'
            : 'none',
        }}
      />
    </div>
  )
}

function DashedLine() {
  return (
    <div className="flex justify-center" style={{ margin: '2px 0' }}>
      <div
        style={{
          width: 1.5,
          height: 14,
          borderRadius: 2,
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(51,65,85,0.45) 0, rgba(51,65,85,0.45) 3px, transparent 3px, transparent 6px)',
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
      className={`relative px-3 py-2.5 rounded-xl flex items-center gap-2.5 w-full overflow-hidden${isRunning ? ' stage-running' : ''}`}
      style={{
        border: `1px solid ${c.border}`,
        background: c.bg,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: isRunning
          ? '0 0 0 1px rgba(51,112,255,0.12), 0 0 28px rgba(51,112,255,0.32), 0 0 60px rgba(51,112,255,0.10), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.15)'
          : isSuccess
          ? '0 0 18px rgba(0,180,42,0.20), inset 0 1px 0 rgba(255,255,255,0.10)'
          : isFailed
          ? '0 0 14px rgba(239,68,68,0.18), inset 0 1px 0 rgba(255,255,255,0.07)'
          : isRejected
          ? '0 0 14px rgba(245,158,11,0.15), inset 0 1px 0 rgba(255,255,255,0.07)'
          : 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Top-edge glass shine */}
      <div
        className="absolute top-0 left-4 right-4 h-px pointer-events-none"
        style={{
          background: isPending
            ? 'rgba(255,255,255,0.04)'
            : `linear-gradient(90deg, transparent, ${c.border}, transparent)`,
        }}
      />

      {/* Scan-line sweep for running state */}
      {isRunning && (
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="animate-stage-scan absolute inset-y-0"
            style={{
              width: '3.5rem',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)',
            }}
          />
        </div>
      )}

      {/* Ping rings for running */}
      {isRunning && (
        <>
          <div className="animate-ping-1 absolute inset-0 rounded-xl border border-[#6388ff] opacity-20 pointer-events-none" />
          <div className="animate-ping-2 absolute inset-0 rounded-xl border border-[#3370ff] opacity-10 pointer-events-none" />
        </>
      )}

      {/* Number badge */}
      <div
        className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 relative"
        style={{
          background: c.badge,
          color: c.badgeText,
          boxShadow: isRunning ? `0 0 8px ${c.badge}` : 'none',
          backdropFilter: 'blur(8px)',
        }}
      >
        {index}
      </div>

      {/* Label */}
      <span
        className="text-xs font-medium flex-1 tracking-wide"
        style={{ color: c.labelColor }}
      >
        {label}
      </span>

      {/* Status icon */}
      {isSuccess && (
        <Check
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: '#4dde7a', filter: 'drop-shadow(0 0 4px rgba(0,180,42,0.6))' }}
        />
      )}
      {isFailed && (
        <X
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: '#fca5a5', filter: 'drop-shadow(0 0 4px rgba(239,68,68,0.5))' }}
        />
      )}
      {isRejected && (
        <RotateCcw
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: '#fcd34d', filter: 'drop-shadow(0 0 4px rgba(245,158,11,0.5))' }}
        />
      )}
      {isRunning && (
        <div className="relative w-2 h-2 shrink-0">
          <div className="absolute inset-0 rounded-full bg-[#6399ff] animate-ping opacity-70" />
          <div
            className="w-2 h-2 rounded-full animate-glow-pulse"
            style={{ background: 'radial-gradient(circle, #93b4ff 0%, #3370ff 100%)' }}
          />
        </div>
      )}
    </div>
  )
}

function CheckpointNode({ num, active }: { num: number; active: boolean }) {
  return (
    <div
      className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg w-full overflow-hidden"
      style={{
        background: active
          ? 'linear-gradient(135deg, rgba(245,158,11,0.16) 0%, rgba(245,158,11,0.07) 100%)'
          : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.06)'}`,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: active
          ? '0 0 20px rgba(245,158,11,0.25), 0 0 40px rgba(245,158,11,0.08), inset 0 1px 0 rgba(255,255,255,0.10)'
          : 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Top shine */}
      <div
        className="absolute top-0 left-3 right-3 h-px pointer-events-none"
        style={{
          background: active
            ? 'linear-gradient(90deg, transparent, rgba(245,158,11,0.5), transparent)'
            : 'rgba(255,255,255,0.04)',
        }}
      />

      {active && (
        <div className="absolute inset-0 rounded-lg border border-[#f59e0b] animate-ping-1 opacity-15 pointer-events-none" />
      )}
      <GitMerge
        className={`w-3 h-3 ${active ? 'text-[#fbbf24]' : 'text-slate-600'}`}
        style={active ? { filter: 'drop-shadow(0 0 5px rgba(245,158,11,0.7))' } : {}}
      />
      <span
        className={`text-[10px] font-mono tracking-wider ${active ? 'text-[#fcd34d]' : 'text-slate-600'}`}
      >
        检查点 {num}
      </span>
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
    <div className="w-full h-full overflow-y-auto px-3 py-3">
      <div className="flex flex-col items-stretch max-w-[220px] mx-auto gap-0">
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
