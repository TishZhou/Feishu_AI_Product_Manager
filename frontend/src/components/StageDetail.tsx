/**
 * StageDetail — simplified compatibility stub.
 * The new ConsoleView uses OverviewView + DetailView directly.
 */
import { useMemo } from 'react'
import { STAGES } from '../types/api'
import type { StageResult, Artifact } from '../types/api'
import { getPersona, HUE_TOKENS } from '../data/personas'

interface StageDetailProps {
  stages: StageResult[]
  artifacts: Artifact[]
  onSelectArtifact: (artifact: Artifact) => void
  viewingStageKey?: string | null
  onClearViewing?: () => void
}

function formatDur(s: number) {
  if (!s) return ''
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
  return `${(s / 60).toFixed(1)}m`
}

export function StageDetail({ stages, artifacts, onSelectArtifact, viewingStageKey }: StageDetailProps) {
  const displayStage = useMemo(() => {
    if (viewingStageKey) {
      const found = stages.find(s => s.stage_key === viewingStageKey)
      if (found) return found
    }
    return stages.find(s => s.status === 'running') ?? stages[stages.length - 1]
  }, [stages, viewingStageKey])

  if (!displayStage) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--c-ink-400)' }}>
        等待流水线启动
      </div>
    )
  }

  const persona = getPersona(displayStage.stage_key)
  const hue = HUE_TOKENS[persona.hue]
  const stageDef = STAGES.find(s => s.key === displayStage.stage_key)
  const stageArts = artifacts.filter(a => a.stage_key === displayStage.stage_key)

  return (
    <div style={{ padding: 24 }}>
      <div style={{
        background: 'white', border: '1px solid var(--c-line-2)',
        borderRadius: 14, padding: 24, boxShadow: 'var(--c-shadow-sm)',
      }}>
        <div style={{ marginBottom: 14 }}>
          <span style={{
            display: 'inline-block', padding: '3px 9px',
            background: hue.softBg, border: `1px solid ${hue.softBorder}`,
            borderRadius: 999, color: hue.solidDark,
            fontSize: 10.5, fontWeight: 600,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            STAGE {String(stageDef?.index ?? 1).padStart(2, '0')}
          </span>
        </div>
        <h2 className="display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-ink-900)', marginBottom: 6 }}>
          {stageDef?.label || displayStage.stage_key}
        </h2>
        <p style={{ color: 'var(--c-ink-500)', fontSize: 13, marginBottom: 20 }}>
          {persona.name} · {persona.role}
        </p>
        {displayStage.duration_seconds > 0 && (
          <div style={{ fontSize: 12, color: 'var(--c-ink-500)', fontFamily: 'JetBrains Mono, monospace' }}>
            {formatDur(displayStage.duration_seconds)} · attempt {displayStage.attempt}
          </div>
        )}
        {stageArts.length > 0 && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stageArts.map(a => (
              <button key={a.id} onClick={() => onSelectArtifact(a)} style={{
                textAlign: 'left', padding: '10px 14px',
                background: 'var(--c-ink-50)', border: '1px solid var(--c-line)',
                borderRadius: 8, cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--c-ink-900)',
              }}>
                {a.filename} <span style={{ color: 'var(--c-ink-400)' }}>· {(a.size_bytes / 1024).toFixed(1)} KB</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
