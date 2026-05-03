import { useMemo } from 'react'
import { STAGES, CHECKPOINT_AFTER } from '../types/api'
import type { StageStatus, RunStatus, StageResult } from '../types/api'
import { Check, X, RotateCcw, Diamond, Eye } from 'lucide-react'

interface PipelineGraphProps {
  stages: StageResult[]
  runStatus: RunStatus
  selectedStageKey?: string | null
  onStageClick?: (key: string) => void
}

type NodeItem =
  | { kind: 'stage'; key: string; label: string; index: number; status: StageStatus; duration: number }
  | { kind: 'checkpoint'; num: number; active: boolean }

/* Status → left accent bar gradient */
const ACCENT_BAR: Record<string, string> = {
  running:   'linear-gradient(180deg,#60a5fa,#818cf8)',
  succeeded: 'linear-gradient(180deg,#34d399,#059669)',
  failed:    'linear-gradient(180deg,#f87171,#dc2626)',
  rejected:  'linear-gradient(180deg,#fbbf24,#d97706)',
  pending:   'transparent',
}

/* Status → ring gradient */
const RING_BG: Record<string, string> = {
  running:   'linear-gradient(135deg,#60a5fa,#6366f1)',
  succeeded: 'linear-gradient(135deg,#34d399,#059669)',
  failed:    'linear-gradient(135deg,#f87171,#dc2626)',
  rejected:  'linear-gradient(135deg,#fbbf24,#d97706)',
  pending:   'rgba(255,255,255,0.06)',
}

/* Status → badge color */
const STATUS_TEXT: Record<string, string> = {
  running:   '#93c5fd',
  succeeded: '#6ee7b7',
  failed:    '#fca5a5',
  rejected:  '#fcd34d',
  pending:   '#1e3a5f',
}

/* Status → accent bar glow */
const BAR_GLOW: Record<string, string> = {
  running:   '0 0 12px rgba(99,132,255,0.80), 0 0 24px rgba(99,132,255,0.40)',
  succeeded: '0 0 8px rgba(52,211,153,0.65)',
  failed:    '0 0 8px rgba(248,113,113,0.65)',
  rejected:  '0 0 8px rgba(251,191,36,0.65)',
  pending:   'none',
}

function formatDur(s: number) {
  if (!s) return ''
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
}

function StageNode({
  label, status, index, duration, isSelected, isClickable, onClick,
}: {
  label: string; status: StageStatus; index: number; duration: number
  isSelected: boolean; isClickable: boolean; onClick: () => void
}) {
  const isRunning  = status === 'running'
  const isSuccess  = status === 'succeeded'
  const isFailed   = status === 'failed'
  const isRejected = status === 'rejected'
  const isPending  = status === 'pending'

  return (
    <div
      className="relative flex items-stretch group/node"
      onClick={isClickable ? onClick : undefined}
      style={{ cursor: isClickable ? 'pointer' : 'default' }}
    >
      {/* Selected glow ring (outermost) */}
      {isSelected && (
        <div className="absolute -inset-[2px] rounded-[14px] pointer-events-none z-0"
          style={{
            boxShadow: isSuccess
              ? '0 0 0 2px rgba(52,211,153,0.65), 0 0 24px rgba(52,211,153,0.22)'
              : isFailed
              ? '0 0 0 2px rgba(248,113,113,0.65), 0 0 24px rgba(248,113,113,0.22)'
              : '0 0 0 2px rgba(99,162,255,0.65), 0 0 24px rgba(79,142,255,0.22)',
          }} />
      )}

      {/* Hover lift handled by group/node hover within inline styles */}

      {/* Left accent bar */}
      <div className="w-[3px] rounded-l-full shrink-0 my-[3px] relative z-10 transition-all duration-200"
        style={{
          background: ACCENT_BAR[status] || 'transparent',
          opacity: isPending ? 0 : 1,
          boxShadow: BAR_GLOW[status] || 'none',
        }} />

      {/* Glass card body */}
      <div
        className={`relative flex-1 flex items-center gap-2.5 pl-3 pr-3 py-3 overflow-hidden z-10${isRunning ? ' stage-running' : ''}`}
        style={{
          /* Frosted glass card — blue-tinted */
          background: isRunning
            ? 'rgba(15, 40, 100, 0.62)'
            : isSelected
            ? 'rgba(18, 42, 105, 0.70)'
            : 'rgba(10, 26, 70, 0.52)',
          backdropFilter: 'blur(18px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
          borderTop: `1px solid ${isSelected
            ? (isSuccess ? 'rgba(52,211,153,0)' : 'rgba(99,162,255,0)')
            : isPending ? 'rgba(99,155,255,0.05)' : 'rgba(99,155,255,0.16)'}`,
          borderRight: `1px solid ${isPending ? 'rgba(99,155,255,0.05)' : 'rgba(99,155,255,0.16)'}`,
          borderBottom: `1px solid ${isPending ? 'rgba(99,155,255,0.05)' : 'rgba(99,155,255,0.10)'}`,
          borderLeft: 'none',
          borderRadius: '0 12px 12px 0',
          boxShadow: isRunning
            ? undefined /* handled by stage-running animation */
            : isSelected
            ? '0 4px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.13)'
            : '0 2px 14px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)',
          transition: 'box-shadow 0.25s ease, background 0.25s ease',
        }}
      >
        {/* Top highlight (glass shine) */}
        <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
          style={{ background: isPending ? 'transparent' : 'linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)' }} />

        {/* Hover tint */}
        {isClickable && (
          <div className="absolute inset-0 opacity-0 group-hover/node:opacity-100 transition-opacity duration-200 pointer-events-none"
            style={{ background: 'rgba(99,155,255,0.05)' }} />
        )}

        {/* Scan sweep for running */}
        {isRunning && (
          <div className="absolute inset-0 overflow-hidden rounded-[0_12px_12px_0] pointer-events-none">
            <div className="animate-stage-scan absolute inset-y-0"
              style={{ width: '5rem', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)' }} />
          </div>
        )}

        {/* Status ring */}
        <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 relative"
          style={{
            background: RING_BG[status],
            boxShadow: isRunning
              ? '0 0 0 3px rgba(99,132,255,0.18), 0 0 16px rgba(99,132,255,0.55)'
              : isSuccess
              ? '0 0 0 2px rgba(52,211,153,0.18), 0 0 10px rgba(52,211,153,0.35)'
              : 'none',
          }}>
          {isSuccess  && <Check     className="w-[11px] h-[11px] text-white" strokeWidth={3} />}
          {isFailed   && <X         className="w-[11px] h-[11px] text-white" strokeWidth={3} />}
          {isRejected && <RotateCcw className="w-[10px] h-[10px] text-white" strokeWidth={2.5} />}
          {(isRunning || isPending) && (
            <span className="text-[10px] font-bold" style={{ color: isPending ? '#1e3a5f' : 'white' }}>{index}</span>
          )}
          {isRunning && (
            <div className="absolute inset-0 rounded-full border-2 border-blue-400 animate-ping-1 opacity-20 pointer-events-none" />
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold truncate" style={{ color: STATUS_TEXT[status] || '#1e3a5f' }}>
            {label}
          </div>
          {isSuccess && duration > 0 && (
            <div className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(52,211,153,0.55)' }}>{formatDur(duration)}</div>
          )}
          {isPending && (
            <div className="text-[10px] mt-0.5" style={{ color: '#0f2040' }}>等待中</div>
          )}
        </div>

        {/* Running pulse dot */}
        {isRunning && (
          <div className="relative w-2 h-2 shrink-0">
            <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-70" />
            <div className="w-2 h-2 rounded-full" style={{ background: 'linear-gradient(135deg,#93c5fd,#3b82f6)' }} />
          </div>
        )}

        {/* Eye icon on hover for clickable stages */}
        {isClickable && !isSelected && (isSuccess || isFailed || isRejected) && (
          <Eye className="w-3 h-3 shrink-0 opacity-0 group-hover/node:opacity-50 transition-opacity text-blue-300" />
        )}

        {/* Viewing indicator */}
        {isSelected && (
          <div className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
            style={{
              background: isSuccess ? 'rgba(52,211,153,0.18)' : 'rgba(79,142,255,0.18)',
              border: isSuccess ? '1px solid rgba(52,211,153,0.45)' : '1px solid rgba(99,162,255,0.45)',
            }}>
            <Eye className="w-2 h-2 text-white" />
          </div>
        )}
      </div>
    </div>
  )
}

function ConnectorTrack({ fromStatus }: { fromStatus: StageStatus }) {
  const done    = fromStatus === 'succeeded'
  const running = fromStatus === 'running'
  return (
    <div className="flex" style={{ margin: '1px 0', paddingLeft: '1.5px' }}>
      <div className="relative" style={{ width: 3, height: 16 }}>
        <div className="absolute inset-0 rounded-full" style={{ background: 'rgba(12,30,70,0.8)' }} />
        {(done || running) && (
          <div className="absolute inset-0 rounded-full transition-all duration-500" style={{
            background: done ? 'linear-gradient(180deg,#34d399,#10b981)' : 'linear-gradient(180deg,#60a5fa,#818cf8)',
            boxShadow: running ? '0 0 8px rgba(99,132,255,0.7)' : '0 0 5px rgba(52,211,153,0.5)',
          }} />
        )}
      </div>
    </div>
  )
}

function DashedConnector() {
  return (
    <div className="flex" style={{ margin: '1px 0', paddingLeft: '1.5px' }}>
      <div style={{
        width: 3, height: 14,
        backgroundImage: 'repeating-linear-gradient(180deg,rgba(12,30,70,0.9) 0,rgba(12,30,70,0.9) 3px,transparent 3px,transparent 7px)',
      }} />
    </div>
  )
}

function CheckpointNode({ num, active }: { num: number; active: boolean }) {
  return (
    <div className="flex items-center gap-0 py-1" style={{ paddingLeft: '1.5px' }}>
      <div className="h-px flex-1" style={{ background: active ? 'rgba(251,191,36,0.30)' : 'rgba(12,30,70,0.8)' }} />
      <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full mx-1 transition-all duration-300"
        style={{
          background: active ? 'rgba(245,158,11,0.12)' : 'rgba(8,20,50,0.55)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${active ? 'rgba(245,158,11,0.40)' : 'rgba(99,155,255,0.08)'}`,
          boxShadow: active
            ? '0 0 20px rgba(245,158,11,0.28), inset 0 1px 0 rgba(255,255,255,0.10)'
            : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}>
        <Diamond className="w-2.5 h-2.5" style={{
          color: active ? '#fbbf24' : '#1e3a5f',
          fill: active ? 'rgba(251,191,36,0.22)' : 'transparent',
          filter: active ? 'drop-shadow(0 0 5px rgba(245,158,11,0.7))' : 'none',
        }} />
        <span className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: active ? '#fcd34d' : '#1e3a5f' }}>
          检查点 {num}
        </span>
      </div>
      <div className="h-px flex-1" style={{ background: active ? 'rgba(251,191,36,0.30)' : 'rgba(12,30,70,0.8)' }} />
    </div>
  )
}

export function PipelineGraph({ stages, runStatus, selectedStageKey, onStageClick }: PipelineGraphProps) {
  const items = useMemo<NodeItem[]>(() => {
    const result: NodeItem[] = []
    STAGES.forEach(def => {
      const r = stages.find(s => s.stage_key === def.key)
      result.push({
        kind: 'stage', key: def.key, label: def.label, index: def.index,
        status: r?.status ?? 'pending', duration: r?.duration_seconds ?? 0,
      })
      const cpNum = CHECKPOINT_AFTER[def.key]
      if (cpNum) result.push({ kind: 'checkpoint', num: cpNum, active: runStatus === 'waiting_for_approval' })
    })
    return result
  }, [stages, runStatus])

  return (
    <div className="w-full h-full overflow-y-auto px-3 py-2">
      <div className="flex flex-col">
        {items.map((item, i) => {
          const prev       = items[i - 1]
          const prevStatus: StageStatus = prev?.kind === 'stage' ? prev.status : 'pending'
          const toChk      = item.kind === 'checkpoint' && prev?.kind === 'stage'
          const fromChk    = item.kind === 'stage' && prev?.kind === 'checkpoint'

          return (
            <div key={item.kind === 'stage' ? item.key : `cp-${item.num}`}>
              {i > 0 && (toChk || fromChk
                ? <DashedConnector />
                : <ConnectorTrack fromStatus={prevStatus} />
              )}
              {item.kind === 'stage' ? (
                <StageNode
                  label={item.label} status={item.status} index={item.index} duration={item.duration}
                  isSelected={selectedStageKey === item.key}
                  isClickable={item.status !== 'pending' && !!onStageClick}
                  onClick={() => onStageClick?.(item.key)}
                />
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
