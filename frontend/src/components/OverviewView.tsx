import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { STAGES } from '../types/api'
import type { StageResult, Artifact } from '../types/api'
import { getPersona, HUE_TOKENS } from '../data/personas'
import { apiClient } from '../lib/api'
import { artifactLabel } from '../lib/artifactLabels'
import { primaryArtifactForStage } from '../lib/stageArtifacts'
import { ArtifactContentView } from './ArtifactContentView'

interface OverviewViewProps {
  stages: StageResult[]
  artifacts: Artifact[]
  elapsed: number
  tokenUsage: Record<string, number>
  onShowDetail: () => void
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}
function formatTimeShort(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(m)}:${pad(sec)}`
}
function formatTokens(n: number) {
  if (n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function OverviewView({ stages, artifacts, elapsed, tokenUsage, onShowDetail }: OverviewViewProps) {
  const activeStage = useMemo(() => {
    const running = stages.find(s => s.status === 'running')
    if (running) return running
    const lastFinished = [...stages].reverse().find(s => s.status === 'succeeded' || s.status === 'failed')
    return lastFinished ?? stages[0]
  }, [stages])

  const persona = getPersona(activeStage?.stage_key)
  const hue = HUE_TOKENS[persona.hue]
  const stageDef = STAGES.find(s => s.key === activeStage?.stage_key)
  const stageIndex = stageDef?.index ?? 1
  const succeededCount = stages.filter(s => s.status === 'succeeded').length
  const titleLines = persona.heroTitle.split('\n')
  const activeStageArtifacts = artifacts.filter(a => a.stage_key === activeStage?.stage_key)
  const primaryArtifact = primaryArtifactForStage(activeStage?.stage_key, activeStageArtifacts)
  const [previewContent, setPreviewContent] = useState('')
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null)

  useEffect(() => {
    if (!primaryArtifact) {
      setPreviewContent('')
      setPreviewArtifactId(null)
      return
    }
    let cancelled = false
    setPreviewContent('加载中…')
    setPreviewArtifactId(primaryArtifact.id)
    apiClient.getArtifactContent(primaryArtifact).then(data => {
      if (!cancelled) setPreviewContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
    }).catch(() => {
      if (!cancelled) setPreviewContent('')
    })
    return () => { cancelled = true }
  }, [primaryArtifact])

  // Token aggregation
  const totalTokens = Object.values(tokenUsage).reduce((a, b) => a + b, 0)
  const tokenStr = formatTokens(totalTokens)
  // Find provider/model from the most recent stage that has data
  const recentStage = [...stages].reverse().find(s => s.provider && (s.status === 'running' || s.status === 'succeeded'))
  const providerLabel = recentStage
    ? (() => {
        const p = recentStage.provider || ''
        const m = recentStage.model || 'default'
        const mShort = m.startsWith('ep-') && m.length > 20 ? m.slice(0, 10) + '…' + m.slice(-6) : m.length > 20 ? m.slice(0, 20) + '…' : m
        return `${p} · ${mShort}`
      })()
    : null

  return (
    <div className="fade-up" style={{ maxWidth: 920, margin: '0 auto' }}>
      {/* Eyebrow + title */}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div className="fade-up" style={{
          fontSize: 11, color: 'var(--c-ink-400)', textTransform: 'uppercase',
          letterSpacing: '0.14em', fontWeight: 500, marginBottom: 14, animationDelay: '0.20s',
        }}>
          运行中 · ACTIVE PIPELINE
        </div>
        <h1 className="display fade-up" style={{
          fontSize: 32, fontWeight: 700, color: 'var(--c-ink-900)',
          lineHeight: 1.1, marginBottom: 8, animationDelay: '0.25s',
        }}>
          您的流水线正在运行
        </h1>
        <p className="serif fade-up" style={{ fontSize: 18, color: 'var(--c-ink-500)', animationDelay: '0.30s' }}>
          {persona.name} · {persona.role} 正在主导当前阶段
        </p>
      </div>

      {/* HERO CARD */}
      <div
        onClick={onShowDetail}
        className="fade-up"
        style={{
          position: 'relative', padding: '32px 36px', borderRadius: 24,
          background: hue.heroGradient, color: 'white', overflow: 'hidden',
          boxShadow: `0 12px 36px ${hue.avatarShadow}, 0 4px 12px ${hue.avatarShadow}`,
          marginBottom: 28, cursor: 'pointer',
          transition: 'transform 0.3s var(--c-ease), box-shadow 0.3s var(--c-ease)',
          animationDelay: '0.35s', animationDuration: '0.8s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-3px)'
          e.currentTarget.style.boxShadow = `0 18px 50px ${hue.avatarShadow}, 0 6px 16px ${hue.avatarShadow}`
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = `0 12px 36px ${hue.avatarShadow}, 0 4px 12px ${hue.avatarShadow}`
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: hue.heroHighlight, pointerEvents: 'none' }} />
        <div className="animate-orbit" style={{
          position: 'absolute', top: '-50%', right: '-10%',
          width: 400, height: 400,
          background: 'radial-gradient(circle, rgba(255,255,255,0.10), transparent 60%)',
          borderRadius: '50%', pointerEvents: 'none',
        }} />

        <div style={{
          position: 'relative', display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          alignItems: 'center', gap: 32, zIndex: 1,
        }}>
          {/* LEFT: Persona block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              position: 'relative', width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)', border: '1.5px solid rgba(255,255,255,0.28)',
              backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <persona.icon size={22} strokeWidth={1.8} color="white" />
              <span style={{
                position: 'absolute', right: -2, bottom: -2,
                width: 14, height: 14, borderRadius: '50%',
                background: '#86EFAC', border: '2.5px solid white',
                boxShadow: '0 0 10px rgba(134, 239, 172, 0.8)',
              }} className="animate-breathe" />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '3px 10px 3px 7px',
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.20)',
                borderRadius: 999, fontSize: 10, fontWeight: 500, letterSpacing: '0.04em',
                color: 'rgba(255,255,255,0.95)', marginBottom: 8, backdropFilter: 'blur(8px)',
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#86EFAC',
                  boxShadow: '0 0 6px rgba(134, 239, 172, 0.8)',
                }} className="animate-breathe" />
                {persona.name.toUpperCase()} · STAGE {stageIndex} / 7
              </div>
              <div className="display" style={{
                fontSize: 22, fontWeight: 600, color: 'white',
                lineHeight: 1.2, whiteSpace: 'pre-line',
              }}>
                {titleLines.join('\n')}
              </div>
            </div>
          </div>

          {/* DIVIDER */}
          <div style={{
            width: 1, height: 64,
            background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.30), transparent)',
          }} />

          {/* RIGHT: Timer + CTA */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 }}>
            <div className="mono" style={{
              fontSize: 38, fontWeight: 600, color: 'white',
              letterSpacing: '-0.02em', lineHeight: 1, fontFeatureSettings: '"tnum"',
            }}>
              {formatTime(elapsed)}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onShowDetail() }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', background: 'white', borderRadius: 10,
                color: hue.solidDark, fontSize: 12.5, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.10)', transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.18)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.10)'
              }}
            >
              查看详情
              <ArrowUpRight size={12} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {primaryArtifact && previewArtifactId === primaryArtifact.id && previewContent && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              zIndex: 1,
              marginTop: 24,
              maxHeight: 220,
              overflow: 'auto',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.92)',
              border: '1px solid rgba(255,255,255,0.40)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
            }}
          >
            <div style={{
              padding: '9px 14px',
              borderBottom: '1px solid rgba(15,23,42,0.08)',
              fontSize: 11,
              fontWeight: 700,
              color: hue.solidDark,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              {artifactLabel(primaryArtifact.filename)}
            </div>
            <ArtifactContentView filename={primaryArtifact.filename} content={previewContent} variant="light" compact />
          </div>
        )}
      </div>

      {/* STATS GRID */}
      <div className="fade-up" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12, marginBottom: 28, animationDelay: '0.45s',
      }}>
        <StatCard label="已完成阶段" value={`${succeededCount}`} unit={`/ ${STAGES.length}`} trend={persona.role} trendUp />
        <StatCard label="运行时长" value={formatTimeShort(elapsed)} unit="" trend="持续递增" />
        <StatCard label="已生成产物" value={`${artifacts.length}`} unit="个" trend={`${(artifacts.reduce((s, a) => s + a.size_bytes, 0) / 1024).toFixed(1)} KB`} />
        <TokenStatCard tokenStr={tokenStr} providerLabel={providerLabel} />
      </div>

      {/* PIPELINE STRIP */}
      <div className="fade-up" style={{
        background: 'white', border: '1px solid var(--c-line-2)', borderRadius: 16,
        padding: '20px 22px', boxShadow: 'var(--c-shadow-sm)', animationDelay: '0.55s',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{
            fontSize: 11.5, color: 'var(--c-ink-500)', textTransform: 'uppercase',
            letterSpacing: '0.10em', fontWeight: 600,
          }}>流水线总览</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--c-ink-500)' }}>
            <span style={{ color: hue.solid, fontWeight: 600 }}>{succeededCount} / {STAGES.length}</span>
            <span style={{ color: 'var(--c-ink-300)' }}> · </span>
            进行中 {String(stageIndex).padStart(2, '0')}
          </span>
        </div>

        {/* Progress track */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {STAGES.map(def => {
            const r = stages.find(s => s.stage_key === def.key)
            const status = r?.status ?? 'pending'
            const stagePersona = getPersona(def.key)
            const stageHue = HUE_TOKENS[stagePersona.hue]
            return (
              <div key={def.key} style={{
                flex: 1, height: 5,
                background: status === 'succeeded'
                  ? stageHue.solid
                  : status === 'running'
                    ? `${stageHue.solid}40`
                    : 'var(--c-ink-100)',
                borderRadius: 999, overflow: 'hidden', position: 'relative',
              }}>
                {status === 'running' && (
                  <div className="animate-shimmer" style={{
                    position: 'absolute', inset: 0,
                    background: `linear-gradient(90deg, transparent, ${stageHue.solid}, transparent)`,
                  }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Stage labels */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 4 }}>
          {STAGES.map(def => {
            const r = stages.find(s => s.stage_key === def.key)
            const status = r?.status ?? 'pending'
            const isDone = status === 'succeeded'
            const isRun = status === 'running'
            const stagePersona = getPersona(def.key)
            const stageHue = HUE_TOKENS[stagePersona.hue]
            return (
              <div key={def.key} style={{
                textAlign: 'center', fontSize: 11,
                color: isDone ? 'var(--c-ink-700)' : isRun ? stageHue.solidDark : 'var(--c-ink-400)',
                fontWeight: isRun ? 500 : 400, transition: 'color 0.2s ease',
              }}>
                {def.label}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── TOKEN stat card ──────────────────────────────────────────────────────────

function TokenStatCard({ tokenStr, providerLabel }: {
  tokenStr: string | null
  providerLabel: string | null
}) {
  return (
    <div
      style={{
        padding: '16px 18px', background: 'white', border: '1px solid var(--c-line-2)',
        borderRadius: 14, transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-ink-300)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--c-shadow-md)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-line-2)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{
        fontSize: 10.5, color: 'var(--c-ink-500)', textTransform: 'uppercase',
        letterSpacing: '0.10em', fontWeight: 500, marginBottom: 8,
      }}>TOKEN 消耗</div>

      <div className="mono" style={{
        fontSize: 22, fontWeight: 600, color: 'var(--c-ink-900)',
        letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 4,
        fontFeatureSettings: '"tnum"',
      }}>
        {tokenStr != null ? (
          <>
            {tokenStr.replace(/[km]/gi, '')}
            {tokenStr.match(/[km]/i) && (
              <span style={{ fontSize: 13, color: 'var(--c-ink-400)', marginLeft: 1, fontWeight: 500 }}>
                {tokenStr.match(/[km]/i)?.[0]}
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--c-ink-400)', fontWeight: 400 }}>等待中…</span>
        )}
      </div>

      {providerLabel && (
        <div style={{
          fontSize: 11, color: 'var(--c-ink-500)',
          textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          {providerLabel}
        </div>
      )}
      {!providerLabel && (
        <div style={{ fontSize: 11, color: 'var(--c-ink-400)' }}>—</div>
      )}
    </div>
  )
}

// ─── Generic stat card ────────────────────────────────────────────────────────

function StatCard({ label, value, unit, trend, trendUp }: {
  label: string; value: string; unit?: string; trend?: string; trendUp?: boolean
}) {
  return (
    <div
      style={{
        padding: '16px 18px', background: 'white', border: '1px solid var(--c-line-2)',
        borderRadius: 14, transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-ink-300)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--c-shadow-md)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-line-2)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{
        fontSize: 10.5, color: 'var(--c-ink-500)', textTransform: 'uppercase',
        letterSpacing: '0.10em', fontWeight: 500, marginBottom: 8,
      }}>{label}</div>
      <div className="mono" style={{
        fontSize: 22, fontWeight: 600, color: 'var(--c-ink-900)',
        letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 4, fontFeatureSettings: '"tnum"',
      }}>
        {value}
        {unit && <span style={{ fontSize: 13, color: 'var(--c-ink-400)', marginLeft: 2, fontWeight: 500 }}>{unit}</span>}
      </div>
      {trend && (
        <div style={{
          fontSize: 11,
          color: trendUp ? 'var(--c-ink-700)' : 'var(--c-ink-500)',
          textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          {trend}
        </div>
      )}
    </div>
  )
}
