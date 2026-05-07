import { useMemo } from 'react'
import { STAGES, CHECKPOINT_AFTER } from '../types/api'
import type { StageStatus, RunStatus, StageResult } from '../types/api'
import { HUE_TOKENS, getPersona } from '../data/personas'

interface PipelineGraphProps {
  stages: StageResult[]
  runStatus: RunStatus
  selectedStageKey?: string | null
  onStageClick?: (key: string) => void
}

type NodeItem =
  | { kind: 'stage'; key: string; label: string; index: number; status: StageStatus; duration: number; attempt: number; attemptCount: number }
  | { kind: 'checkpoint'; num: number; active: boolean }

function formatDur(s: number) {
  if (!s) return ''
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
  return `${(s / 60).toFixed(1)}m`
}

function StageRow({
  stageKey, label, index, status, duration, attempt, attemptCount, isSelected, isClickable, onClick,
}: {
  stageKey: string; label: string; index: number; status: StageStatus; duration: number
  attempt: number; attemptCount: number
  isSelected: boolean; isClickable: boolean; onClick: () => void
}) {
  const persona = getPersona(stageKey)
  const hue = HUE_TOKENS[persona.hue]
  const isRunning = status === 'running'
  const isDone = status === 'succeeded'
  const isFailed = status === 'failed'
  const isPending = status === 'pending'

  let coreBg = '#FFFFFF'
  let coreBorder = '1.5px solid var(--c-ink-300)'
  let coreShadow = ''

  if (isDone) {
    coreBg = hue.solid
    coreBorder = `1.5px solid ${hue.solid}`
  } else if (isRunning) {
    coreBg = hue.solid
    coreBorder = `1.5px solid ${hue.solid}`
    coreShadow = `0 0 0 4px rgba(${hue.pulseRGB}, 0.18)`
  } else if (isFailed) {
    coreBg = '#EF4444'
    coreBorder = '1.5px solid #EF4444'
  }

  const rowBg = isRunning
    ? `linear-gradient(90deg, rgba(${hue.pulseRGB}, 0.10), rgba(${hue.pulseRGB}, 0))`
    : isSelected
      ? 'rgba(15, 23, 42, 0.04)'
      : 'transparent'

  const labelColor = isRunning ? hue.solidDark
    : isDone ? 'var(--c-ink-700)'
    : isFailed ? '#B91C1C'
    : isPending ? 'var(--c-ink-400)'
    : 'var(--c-ink-500)'

  const numColor = isRunning ? hue.solid
    : isDone ? 'var(--c-ink-500)'
    : 'var(--c-ink-400)'

  // Show attempt indicator when the stage has been retried (>1 attempts).
  const showAttempt = attemptCount > 1
  const retryColor = isRunning ? hue.solidDark : isFailed ? '#B91C1C' : 'var(--c-ink-500)'

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        padding: '6px 8px 6px 4px',
        borderRadius: 8,
        background: rowBg,
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'background 0.18s ease',
        color: labelColor,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: isRunning ? 500 : 400 }}>
        {/* Marker on timeline */}
        <div style={{
          position: 'relative', zIndex: 1,
          width: 16, height: 16, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: 'var(--c-bg)', borderRadius: '50%',
        }}>
          <div
            className={isRunning ? 'animate-breathe' : ''}
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: coreBg, border: coreBorder,
              boxShadow: coreShadow, transition: 'all 0.2s ease',
            }}
          />
        </div>

        {/* Index */}
        <span className="mono" style={{ fontSize: 9.5, color: numColor, width: 14, fontWeight: 500 }}>
          {String(index).padStart(2, '0')}
        </span>

        {/* Label */}
        <span style={{ flex: 1, letterSpacing: '-0.005em' }}>{label}</span>

        {/* Duration */}
        {duration > 0 && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--c-ink-400)' }}>
            {formatDur(duration)}
          </span>
        )}
        {isRunning && duration === 0 && (
          <span className="mono" style={{ fontSize: 11, color: hue.solid, fontWeight: 500 }}>…</span>
        )}
      </div>

      {/* Attempt indicator — shows underneath when stage retried */}
      {showAttempt && (
        <div className="mono" style={{
          marginLeft: 40, marginTop: 2,
          fontSize: 10, color: retryColor, letterSpacing: '0.02em',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ opacity: 0.7 }}>↻</span>
          <span>第 {attempt} / {attemptCount} 次尝试</span>
        </div>
      )}
    </div>
  )
}

function CheckpointRow({ num, active }: { num: number; active: boolean }) {
  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center',
      gap: 10, padding: '4px 8px 4px 4px', margin: '2px 0',
    }}>
      <div style={{
        position: 'relative', zIndex: 1, width: 16, height: 16,
        display: 'grid', placeItems: 'center', background: 'var(--c-bg)',
      }}>
        <div style={{
          width: 8, height: 8, background: 'white',
          border: active ? '1.5px dashed #F59E0B' : '1.5px dashed var(--c-ink-300)',
          borderRadius: 2, transform: 'rotate(45deg)',
        }} />
      </div>
      <span style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
        color: active ? '#B45309' : 'var(--c-ink-400)', fontWeight: 500,
      }}>
        检查点 {num}
      </span>
    </div>
  )
}

export function PipelineGraph({ stages, runStatus, selectedStageKey, onStageClick }: PipelineGraphProps) {
  const items = useMemo<NodeItem[]>(() => {
    const result: NodeItem[] = []
    STAGES.forEach(def => {
      // A stage may have multiple StageResult rows (one per attempt). Show the
      // *latest* attempt's status so retries during code_gen / test_gen / review
      // surface in real time, plus an attempt counter underneath.
      const matching = stages.filter(s => s.stage_key === def.key)
      const latest = matching.length
        ? matching.reduce((max, s) => (s.attempt > max.attempt ? s : max), matching[0])
        : null
      result.push({
        kind: 'stage',
        key: def.key,
        label: def.label,
        index: def.index,
        status: latest?.status ?? 'pending',
        duration: latest?.duration_seconds ?? 0,
        attempt: latest?.attempt ?? 1,
        attemptCount: matching.length,
      })
      const cpNum = CHECKPOINT_AFTER[def.key]
      if (cpNum) result.push({ kind: 'checkpoint', num: cpNum, active: runStatus === 'waiting_for_approval' })
    })
    return result
  }, [stages, runStatus])

  return (
    <div style={{ position: 'relative', padding: '4px 4px 4px 8px' }}>
      {/* Vertical timeline */}
      <div style={{
        position: 'absolute', left: 16, top: 16, bottom: 16,
        width: 1.5, background: 'var(--c-line-2)', borderRadius: 1,
      }} />

      {items.map(item =>
        item.kind === 'stage' ? (
          <StageRow
            key={item.key}
            stageKey={item.key}
            label={item.label}
            index={item.index}
            status={item.status}
            duration={item.duration}
            attempt={item.attempt}
            attemptCount={item.attemptCount}
            isSelected={selectedStageKey === item.key}
            isClickable={item.status !== 'pending' && !!onStageClick}
            onClick={() => onStageClick?.(item.key)}
          />
        ) : (
          <CheckpointRow key={`cp-${item.num}`} num={item.num} active={item.active} />
        )
      )}
    </div>
  )
}
