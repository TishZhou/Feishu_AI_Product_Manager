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

const STATUS_ACCENT: Record<string, string> = {
  running:   'linear-gradient(180deg,#60a5fa 0%,#818cf8 100%)',
  succeeded: 'linear-gradient(180deg,#34d399 0%,#059669 100%)',
  failed:    'linear-gradient(180deg,#f87171 0%,#dc2626 100%)',
  rejected:  'linear-gradient(180deg,#fbbf24 0%,#d97706 100%)',
  pending:   'transparent',
}

const STATUS_CARD_BG: Record<string, string> = {
  running:   'linear-gradient(120deg,rgba(59,130,246,0.20) 0%,rgba(99,102,241,0.12) 100%)',
  succeeded: 'linear-gradient(120deg,rgba(16,185,129,0.15) 0%,rgba(52,211,153,0.07) 100%)',
  failed:    'linear-gradient(120deg,rgba(239,68,68,0.15) 0%,rgba(248,113,113,0.07) 100%)',
  rejected:  'linear-gradient(120deg,rgba(245,158,11,0.15) 0%,rgba(251,191,36,0.07) 100%)',
  pending:   'rgba(255,255,255,0.02)',
}

const STATUS_BORDER: Record<string, string> = {
  running:   'rgba(99,132,255,0.55)',
  succeeded: 'rgba(52,211,153,0.40)',
  failed:    'rgba(248,113,113,0.40)',
  rejected:  'rgba(251,191,36,0.40)',
  pending:   'rgba(255,255,255,0.06)',
}

const STATUS_RING_BG: Record<string, string> = {
  running:   'linear-gradient(135deg,#60a5fa,#818cf8)',
  succeeded: 'linear-gradient(135deg,#34d399,#059669)',
  failed:    'linear-gradient(135deg,#f87171,#dc2626)',
  rejected:  'linear-gradient(135deg,#fbbf24,#d97706)',
  pending:   'rgba(255,255,255,0.06)',
}

const STATUS_LABEL_COLOR: Record<string, string> = {
  running:   '#e0eaff',
  succeeded: '#d1fae5',
  failed:    '#fee2e2',
  rejected:  '#fef3c7',
  pending:   '#374151',
}

function formatDur(s: number) {
  if (!s) return ''
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
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
      className="relative flex items-stretch"
      onClick={isClickable ? onClick : undefined}
      style={{ cursor: isClickable ? 'pointer' : 'default' }}
    >
      {/* Outer glow for selected */}
      {isSelected && (
        <div
          className="absolute -inset-[2px] rounded-[14px] pointer-events-none z-0"
          style={{
            background: 'transparent',
            boxShadow: isSuccess
              ? '0 0 0 2px rgba(52,211,153,0.7), 0 0 20px rgba(52,211,153,0.25)'
              : isFailed
              ? '0 0 0 2px rgba(248,113,113,0.7), 0 0 20px rgba(248,113,113,0.25)'
              : '0 0 0 2px rgba(99,132,255,0.7), 0 0 20px rgba(99,132,255,0.25)',
          }}
        />
      )}

      {/* Left accent bar */}
      <div
        className="w-[3px] rounded-l-full shrink-0 my-[3px] relative z-10"
        style={{
          background: STATUS_ACCENT[status] || 'transparent',
          opacity: isPending ? 0 : 1,
          boxShadow: isRunning
            ? '0 0 10px rgba(99,132,255,0.8), 0 0 24px rgba(99,132,255,0.4)'
            : isSuccess
            ? '0 0 8px rgba(52,211,153,0.6)'
            : 'none',
        }}
      />

      {/* Card body */}
      <div
        className={`relative flex-1 flex items-center gap-2.5 pl-3 pr-3 py-3 overflow-hidden z-10 group/card${isRunning ? ' stage-running' : ''}`}
        style={{
          background: STATUS_CARD_BG[status] || 'rgba(255,255,255,0.02)',
          borderTop: `1px solid ${isSelected ? 'transparent' : STATUS_BORDER[status] || 'rgba(255,255,255,0.06)'}`,
          borderRight: `1px solid ${isSelected ? 'transparent' : STATUS_BORDER[status] || 'rgba(255,255,255,0.06)'}`,
          borderBottom: `1px solid ${isSelected ? 'transparent' : STATUS_BORDER[status] || 'rgba(255,255,255,0.06)'}`,
          borderLeft: 'none',
          borderRadius: '0 12px 12px 0',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: isRunning
            ? '0 4px 32px rgba(59,130,246,0.22), inset 0 1px 0 rgba(255,255,255,0.14)'
            : isSuccess
            ? '0 2px 12px rgba(16,185,129,0.10), inset 0 1px 0 rgba(52,211,153,0.12)'
            : 'inset 0 1px 0 rgba(255,255,255,0.04)',
          transition: 'box-shadow 0.2s, background 0.2s',
        }}
      >
        {/* Top highlight */}
        <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
          style={{ background: isPending ? 'rgba(255,255,255,0.03)' : `linear-gradient(90deg,transparent,${STATUS_BORDER[status] || 'transparent'},transparent)` }} />

        {/* Hover tint */}
        {isClickable && !isPending && (
          <div className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none"
            style={{ background: 'rgba(255,255,255,0.04)' }} />
        )}

        {/* Scan sweep */}
        {isRunning && (
          <div className="absolute inset-0 overflow-hidden rounded-[0_12px_12px_0] pointer-events-none">
            <div className="animate-stage-scan absolute inset-y-0"
              style={{ width: '5rem', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.09),transparent)' }} />
          </div>
        )}

        {/* Status ring */}
        <div
          className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 relative"
          style={{
            background: STATUS_RING_BG[status] || 'rgba(255,255,255,0.06)',
            boxShadow: isRunning
              ? '0 0 0 3px rgba(99,132,255,0.20), 0 0 16px rgba(99,132,255,0.55)'
              : isSuccess
              ? '0 0 0 2px rgba(52,211,153,0.18), 0 0 10px rgba(52,211,153,0.35)'
              : 'none',
          }}
        >
          {isSuccess  && <Check       className="w-[11px] h-[11px] text-white" strokeWidth={3} />}
          {isFailed   && <X           className="w-[11px] h-[11px] text-white" strokeWidth={3} />}
          {isRejected && <RotateCcw   className="w-[10px] h-[10px] text-white" strokeWidth={2.5} />}
          {(isRunning || isPending) && (
            <span className="text-[10px] font-bold text-white/90">{index}</span>
          )}
          {isRunning && (
            <div className="absolute inset-0 rounded-full border-2 border-[#60a5fa] animate-ping-1 opacity-25 pointer-events-none" />
          )}
        </div>

        {/* Text area */}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold truncate" style={{ color: STATUS_LABEL_COLOR[status] || '#374151' }}>
            {label}
          </div>
          {isSuccess && duration > 0 && (
            <div className="text-[10px] font-mono mt-0.5" style={{ color: 'rgba(52,211,153,0.60)' }}>
              {formatDur(duration)}
            </div>
          )}
          {isFailed && (
            <div className="text-[10px] mt-0.5" style={{ color: 'rgba(248,113,113,0.60)' }}>已失败</div>
          )}
          {isPending && (
            <div className="text-[10px] mt-0.5" style={{ color: '#1f2937' }}>等待中</div>
          )}
        </div>

        {/* Running pulse */}
        {isRunning && (
          <div className="relative w-2 h-2 shrink-0">
            <div className="absolute inset-0 rounded-full bg-[#60a5fa] animate-ping opacity-70" />
            <div className="w-2 h-2 rounded-full" style={{ background: 'linear-gradient(135deg,#93c5fd,#3b82f6)' }} />
          </div>
        )}

        {/* Eye icon for clickable completed stages on hover */}
        {isClickable && (isSuccess || isFailed || isRejected) && !isSelected && (
          <Eye className="w-3 h-3 shrink-0 opacity-0 group-hover/card:opacity-60 transition-opacity text-white" />
        )}

        {/* Selected checkmark */}
        {isSelected && (
          <div className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
            style={{
              background: isSuccess ? 'rgba(52,211,153,0.20)' : 'rgba(99,132,255,0.20)',
              border: isSuccess ? '1px solid rgba(52,211,153,0.50)' : '1px solid rgba(99,132,255,0.50)',
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
        <div className="absolute inset-0 rounded-full" style={{ background: 'rgba(30,41,59,0.8)' }} />
        {(done || running) && (
          <div className="absolute inset-0 rounded-full" style={{
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
        backgroundImage: 'repeating-linear-gradient(180deg,rgba(30,41,59,0.9) 0,rgba(30,41,59,0.9) 3px,transparent 3px,transparent 7px)',
      }} />
    </div>
  )
}

function CheckpointNode({ num, active }: { num: number; active: boolean }) {
  return (
    <div className="flex items-center gap-0 py-1" style={{ paddingLeft: '1.5px' }}>
      <div className="h-px flex-1" style={{ background: active ? 'rgba(251,191,36,0.35)' : 'rgba(30,41,59,0.8)' }} />
      <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full mx-1"
        style={{
          background: active ? 'rgba(245,158,11,0.14)' : 'rgba(15,23,42,0.6)',
          border: `1px solid ${active ? 'rgba(245,158,11,0.50)' : 'rgba(30,41,59,0.9)'}`,
          backdropFilter: 'blur(12px)',
          boxShadow: active ? '0 0 20px rgba(245,158,11,0.30), inset 0 1px 0 rgba(255,255,255,0.10)' : 'none',
        }}>
        <Diamond className="w-2.5 h-2.5" style={{
          color: active ? '#fbbf24' : '#334155',
          fill: active ? 'rgba(251,191,36,0.25)' : 'transparent',
          filter: active ? 'drop-shadow(0 0 5px rgba(245,158,11,0.7))' : 'none',
        }} />
        <span className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: active ? '#fcd34d' : '#334155' }}>
          检查点 {num}
        </span>
      </div>
      <div className="h-px flex-1" style={{ background: active ? 'rgba(251,191,36,0.35)' : 'rgba(30,41,59,0.8)' }} />
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
                  label={item.label}
                  status={item.status}
                  index={item.index}
                  duration={item.duration}
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
