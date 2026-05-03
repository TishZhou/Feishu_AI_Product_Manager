import { useMemo } from 'react'
import { STAGES, CHECKPOINT_AFTER } from '../types/api'
import type { StageStatus, RunStatus } from '../types/api'
import type { StageResult } from '../types/api'
import { Check, X, RotateCcw, Diamond } from 'lucide-react'

interface PipelineGraphProps {
  stages: StageResult[]
  runStatus: RunStatus
}

type NodeItem =
  | { kind: 'stage'; key: string; label: string; index: number; status: StageStatus }
  | { kind: 'checkpoint'; num: number; active: boolean }

function StageNode({ label, status, index }: { label: string; status: StageStatus; index: number }) {
  const isRunning  = status === 'running'
  const isSuccess  = status === 'succeeded'
  const isFailed   = status === 'failed'
  const isRejected = status === 'rejected'
  const isPending  = status === 'pending'

  const accentColor = isRunning
    ? 'linear-gradient(180deg,#60a5fa,#818cf8)'
    : isSuccess
    ? 'linear-gradient(180deg,#34d399,#10b981)'
    : isFailed
    ? 'linear-gradient(180deg,#f87171,#ef4444)'
    : isRejected
    ? 'linear-gradient(180deg,#fbbf24,#f59e0b)'
    : 'transparent'

  const cardBg = isRunning
    ? 'linear-gradient(135deg,rgba(59,130,246,0.18) 0%,rgba(99,102,241,0.10) 100%)'
    : isSuccess
    ? 'linear-gradient(135deg,rgba(16,185,129,0.14) 0%,rgba(52,211,153,0.06) 100%)'
    : isFailed
    ? 'linear-gradient(135deg,rgba(239,68,68,0.14) 0%,rgba(248,113,113,0.06) 100%)'
    : isRejected
    ? 'linear-gradient(135deg,rgba(245,158,11,0.14) 0%,rgba(251,191,36,0.06) 100%)'
    : 'rgba(255,255,255,0.025)'

  const borderColor = isRunning
    ? 'rgba(99,132,255,0.50)'
    : isSuccess
    ? 'rgba(52,211,153,0.35)'
    : isFailed
    ? 'rgba(248,113,113,0.35)'
    : isRejected
    ? 'rgba(251,191,36,0.35)'
    : 'rgba(255,255,255,0.07)'

  const ringBg = isRunning
    ? 'linear-gradient(135deg,#60a5fa,#818cf8)'
    : isSuccess
    ? 'linear-gradient(135deg,#34d399,#059669)'
    : isFailed
    ? 'linear-gradient(135deg,#f87171,#dc2626)'
    : isRejected
    ? 'linear-gradient(135deg,#fbbf24,#d97706)'
    : 'rgba(255,255,255,0.07)'

  const ringText = isPending ? '#475569' : '#fff'

  return (
    <div className="relative flex items-stretch gap-0">
      {/* Left accent bar */}
      <div
        className="w-[3px] rounded-l-full shrink-0 my-[3px]"
        style={{
          background: accentColor,
          opacity: isPending ? 0 : 1,
          boxShadow: isRunning
            ? '0 0 8px rgba(99,132,255,0.7), 0 0 20px rgba(99,132,255,0.3)'
            : isSuccess
            ? '0 0 6px rgba(52,211,153,0.5)'
            : 'none',
        }}
      />

      {/* Card */}
      <div
        className={`relative flex-1 flex items-center gap-2.5 pl-3 pr-3 py-2.5 overflow-hidden${isRunning ? ' stage-running' : ''}`}
        style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderLeft: 'none',
          borderRadius: '0 12px 12px 0',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: isRunning
            ? '0 0 30px rgba(59,130,246,0.20), inset 0 1px 0 rgba(255,255,255,0.12)'
            : isSuccess
            ? 'inset 0 1px 0 rgba(52,211,153,0.12)'
            : isFailed
            ? 'inset 0 1px 0 rgba(248,113,113,0.10)'
            : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {/* Top shine line */}
        <div
          className="absolute top-0 left-0 right-0 h-px pointer-events-none"
          style={{
            background: isPending
              ? 'rgba(255,255,255,0.03)'
              : `linear-gradient(90deg, transparent, ${borderColor}, transparent)`,
          }}
        />

        {/* Scan sweep for running */}
        {isRunning && (
          <div className="absolute inset-0 overflow-hidden rounded-[0_12px_12px_0] pointer-events-none">
            <div
              className="animate-stage-scan absolute inset-y-0"
              style={{
                width: '4rem',
                background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)',
              }}
            />
          </div>
        )}

        {/* Status ring */}
        <div
          className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 relative"
          style={{
            background: ringBg,
            color: ringText,
            boxShadow: isRunning
              ? '0 0 0 2px rgba(99,132,255,0.25), 0 0 12px rgba(99,132,255,0.5)'
              : isSuccess
              ? '0 0 0 2px rgba(52,211,153,0.2), 0 0 8px rgba(52,211,153,0.3)'
              : 'none',
          }}
        >
          {isSuccess && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          {isFailed && <X className="w-3 h-3 text-white" strokeWidth={3} />}
          {isRejected && <RotateCcw className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
          {(isRunning || isPending) && (
            <span className="text-[10px] font-bold" style={{ color: ringText }}>{index}</span>
          )}
          {isRunning && (
            <div className="absolute inset-0 rounded-full border-2 border-[#60a5fa] animate-ping-1 opacity-30 pointer-events-none" />
          )}
        </div>

        {/* Label */}
        <span
          className="text-[12px] font-medium flex-1 tracking-wide"
          style={{
            color: isPending ? '#475569' : isRunning ? '#e0eaff' : isSuccess ? '#d1fae5' : isFailed ? '#fee2e2' : '#fef3c7',
          }}
        >
          {label}
        </span>

        {/* Running pulse dot */}
        {isRunning && (
          <div className="relative w-2 h-2 shrink-0">
            <div className="absolute inset-0 rounded-full bg-[#60a5fa] animate-ping opacity-75" />
            <div className="w-2 h-2 rounded-full bg-gradient-to-br from-[#93c5fd] to-[#3b82f6]" />
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectorTrack({ fromStatus }: { fromStatus: StageStatus }) {
  const isActive    = fromStatus === 'running'
  const isCompleted = fromStatus === 'succeeded'

  return (
    <div className="flex" style={{ margin: '1px 0', paddingLeft: '1.5px' }}>
      <div className="relative" style={{ width: 3, height: 14 }}>
        {/* Track */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: 'rgba(51,65,85,0.4)' }}
        />
        {/* Fill */}
        {(isActive || isCompleted) && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: isCompleted
                ? 'linear-gradient(180deg,#34d399,#10b981)'
                : 'linear-gradient(180deg,#60a5fa,#818cf8)',
              boxShadow: isActive ? '0 0 6px rgba(99,132,255,0.6)' : '0 0 4px rgba(52,211,153,0.4)',
            }}
          />
        )}
      </div>
    </div>
  )
}

function DashedConnector() {
  return (
    <div className="flex" style={{ margin: '1px 0', paddingLeft: '1.5px' }}>
      <div
        style={{
          width: 3,
          height: 12,
          backgroundImage: 'repeating-linear-gradient(180deg,rgba(51,65,85,0.5) 0,rgba(51,65,85,0.5) 3px,transparent 3px,transparent 6px)',
        }}
      />
    </div>
  )
}

function CheckpointNode({ num, active }: { num: number; active: boolean }) {
  return (
    <div className="relative flex items-center gap-2 py-1.5 overflow-hidden" style={{ paddingLeft: '1.5px' }}>
      {/* Left line connector */}
      <div className="flex-1 h-px" style={{ background: active ? 'rgba(251,191,36,0.3)' : 'rgba(51,65,85,0.4)' }} />

      {/* Center diamond */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0"
        style={{
          background: active ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${active ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.08)'}`,
          backdropFilter: 'blur(12px)',
          boxShadow: active ? '0 0 16px rgba(245,158,11,0.25), inset 0 1px 0 rgba(255,255,255,0.10)' : 'none',
        }}
      >
        {active && (
          <div className="absolute inset-0 rounded-full border border-[#f59e0b] animate-ping-1 opacity-20 pointer-events-none" />
        )}
        <Diamond
          className="w-2.5 h-2.5"
          style={{
            color: active ? '#fbbf24' : '#475569',
            fill: active ? 'rgba(251,191,36,0.3)' : 'transparent',
            filter: active ? 'drop-shadow(0 0 4px rgba(245,158,11,0.6))' : 'none',
          }}
        />
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: active ? '#fcd34d' : '#475569' }}
        >
          检查点 {num}
        </span>
      </div>

      {/* Right line connector */}
      <div className="flex-1 h-px" style={{ background: active ? 'rgba(251,191,36,0.3)' : 'rgba(51,65,85,0.4)' }} />
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
      if (cpNum) result.push({ kind: 'checkpoint', num: cpNum, active: runStatus === 'waiting_for_approval' })
    })
    return result
  }, [stages, runStatus])

  return (
    <div className="w-full h-full overflow-y-auto px-3 py-2">
      <div className="flex flex-col" style={{ gap: 0 }}>
        {items.map((item, i) => {
          const prev = items[i - 1]
          const showConnector = i > 0
          const isDashed = prev?.kind === 'stage' && item.kind === 'checkpoint'
          const prevStatus: StageStatus = prev?.kind === 'stage' ? prev.status : 'pending'

          return (
            <div key={item.kind === 'stage' ? item.key : `cp-${item.num}`}>
              {showConnector && (
                item.kind === 'checkpoint' && isDashed
                  ? <DashedConnector />
                  : item.kind === 'stage' && prev?.kind === 'checkpoint'
                  ? <DashedConnector />
                  : <ConnectorTrack fromStatus={prevStatus} />
              )}
              {item.kind === 'stage'
                ? <StageNode label={item.label} status={item.status} index={item.index} />
                : <CheckpointNode num={item.num} active={item.active} />
              }
            </div>
          )
        })}
      </div>
    </div>
  )
}
