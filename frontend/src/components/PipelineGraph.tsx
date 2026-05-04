import { useMemo } from 'react'
import { STAGES, CHECKPOINT_AFTER } from '../types/api'
import type { StageStatus, RunStatus, StageResult } from '../types/api'

interface PipelineGraphProps {
  stages: StageResult[]
  runStatus: RunStatus
  selectedStageKey?: string | null
  onStageClick?: (key: string) => void
}

type NodeItem =
  | { kind: 'stage'; key: string; label: string; index: number; status: StageStatus; duration: number }
  | { kind: 'checkpoint'; num: number; active: boolean }

/* Low-saturation status dot colors — no neon */
const DOT_COLOR: Record<string, string> = {
  running:   'rgba(215,228,255,0.90)',
  succeeded: 'rgba(255,255,255,0.55)',
  failed:    'rgba(255,180,175,0.55)',
  rejected:  'rgba(255,215,145,0.50)',
  pending:   'transparent',
}
const DOT_BORDER: Record<string, string> = {
  running:   'none',
  succeeded: 'none',
  failed:    'none',
  rejected:  'none',
  pending:   '1px solid rgba(255,255,255,0.12)',
}
const TEXT_COLOR: Record<string, string> = {
  running:   'rgba(255,255,255,0.92)',
  succeeded: 'rgba(255,255,255,0.50)',
  failed:    'rgba(255,180,175,0.60)',
  rejected:  'rgba(255,215,145,0.55)',
  pending:   'rgba(255,255,255,0.14)',
}

function formatDur(s: number) {
  if (!s) return ''
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
  return `${(s / 60).toFixed(1)}m`
}

function StageRow({
  label, status, duration, isSelected, isClickable, onClick,
}: {
  label: string; status: StageStatus; duration: number
  isSelected: boolean; isClickable: boolean; onClick: () => void
}) {
  const isRunning = status === 'running'
  const isPending = status === 'pending'
  const dotColor  = DOT_COLOR[status] || 'transparent'
  const dotBorder = DOT_BORDER[status] || 'none'
  const textColor = TEXT_COLOR[status] || 'rgba(255,255,255,0.14)'

  return (
    <div
      className="relative flex items-center"
      style={{
        paddingLeft: 40, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
        cursor: isClickable ? 'pointer' : 'default',
        background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.18s ease',
      }}
      onClick={isClickable ? onClick : undefined}
    >
      {/* Dot on timeline */}
      <div
        className="absolute z-10 flex items-center justify-center"
        style={{ left: 17, top: '50%', transform: 'translateY(-50%)', width: 6, height: 6 }}
      >
        <div
          className={isRunning ? 'animate-pulse' : ''}
          style={{
            width: isRunning ? 7 : 6,
            height: isRunning ? 7 : 6,
            borderRadius: '50%',
            background: dotColor,
            border: dotBorder,
            boxShadow: 'none',
          }}
        />
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <span
          className="text-[12px] font-medium truncate block"
          style={{ color: textColor, letterSpacing: '-0.01em' }}
        >
          {label}
        </span>
      </div>

      {/* Duration — compact */}
      {duration > 0 && (
        <span
          className="text-[10px] font-mono shrink-0 ml-2"
          style={{ color: 'rgba(255,255,255,0.20)', letterSpacing: '0.02em' }}
        >
          {formatDur(duration)}
        </span>
      )}

      {/* Running scan indicator */}
      {isRunning && (
        <span
          className="ml-2 shrink-0 text-[9px] font-mono tracking-widest animate-pulse"
          style={{ color: 'rgba(215,228,255,0.45)' }}
        >
          ···
        </span>
      )}

      {/* Selected right marker */}
      {isSelected && !isPending && (
        <div
          className="absolute right-0 top-[20%] bottom-[20%] w-[2px] rounded-full"
          style={{ background: 'rgba(255,255,255,0.25)' }}
        />
      )}
    </div>
  )
}

function CheckpointRow({ num, active }: { num: number; active: boolean }) {
  return (
    <div
      className="flex items-center"
      style={{ paddingLeft: 40, paddingRight: 16, paddingTop: 6, paddingBottom: 6 }}
    >
      {/* Diamond on timeline */}
      <div
        className="absolute z-10"
        style={{ left: 17, transform: 'translateY(-50%) rotate(45deg)', width: 5, height: 5,
          top: '50%',
          background: active ? 'rgba(255,215,145,0.60)' : 'rgba(255,255,255,0.10)',
        }}
      />
      <span
        className="text-[9px] uppercase tracking-[0.20em]"
        style={{ color: active ? 'rgba(255,215,145,0.50)' : 'rgba(255,255,255,0.14)' }}
      >
        检查点 {num}
      </span>
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
    <div className="w-full h-full overflow-y-auto">
      <div className="relative py-5">
        {/* Continuous vertical timeline line */}
        <div
          className="absolute pointer-events-none"
          style={{ left: 20, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.06)' }}
        />

        {items.map(item =>
          item.kind === 'stage' ? (
            <StageRow
              key={item.key}
              label={item.label}
              status={item.status}
              duration={item.duration}
              isSelected={selectedStageKey === item.key}
              isClickable={item.status !== 'pending' && !!onStageClick}
              onClick={() => onStageClick?.(item.key)}
            />
          ) : (
            <div key={`cp-${item.num}`} className="relative">
              <CheckpointRow num={item.num} active={item.active} />
            </div>
          )
        )}
      </div>
    </div>
  )
}
