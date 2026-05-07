import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, Activity, FileText as FileIcon, Terminal, FileCode2, Zap, RotateCcw } from 'lucide-react'
import { STAGES } from '../types/api'
import type { StageResult, Artifact, RunStatus } from '../types/api'
import { getPersona, HUE_TOKENS } from '../data/personas'
import { LogStream } from './LogStream'
import { ArtifactContentView } from './ArtifactContentView'
import { useRunTokenUsage, useRunActions } from '../hooks/useDevFlow'
import { apiClient } from '../lib/api'
import { artifactLabel } from '../lib/artifactLabels'
import { primaryArtifactForStage } from '../lib/stageArtifacts'

type TabKey = 'progress' | 'artifacts' | 'logs'

interface DetailViewProps {
  stages: StageResult[]
  artifacts: Artifact[]
  runStatus: RunStatus
  runId: string | null
  elapsed: number
  selectedStageKey: string | null
  onSelectArtifact: (a: Artifact) => void
  onShowOverview: () => void
}

function formatTimeShort(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(m)}:${pad(sec)}`
}

function formatDur(s: number) {
  if (!s) return ''
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
  return `${(s / 60).toFixed(1)}m`
}

// ─── SSE log hook ─────────────────────────────────────────────────────────────

interface StreamEntry { stageKey: string; text: string; callId: string; done: boolean }
interface ActivityItem { id: string; level: string; message: string; stageKey: string; time: string }

function useStageStream(runId: string | null) {
  const [streamEntries, setStreamEntries] = useState<StreamEntry[]>([])
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const esRef = useRef<EventSource | null>(null)

  const reset = useCallback(() => {
    setStreamEntries([])
    setActivityItems([])
  }, [])

  useEffect(() => {
    if (!runId) { reset(); return }
    if (esRef.current) { esRef.current.close() }
    reset()

    const es = new EventSource(`/api/runs/${runId}/logs/stream`)
    esRef.current = es

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          level?: string; stage_key?: string; message?: string; call_id?: string; time?: string
        }
        const level = (data.level || 'info').toLowerCase()
        const sk = data.stage_key || ''
        const msg = data.message || ''
        const cid = data.call_id
        const time = data.time || ''

        if (level === 'token' && cid) {
          setStreamEntries(prev => {
            const idx = prev.findIndex(e => e.callId === cid && e.stageKey === sk)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = { ...next[idx], text: next[idx].text + msg }
              return next
            }
            return [...prev, { stageKey: sk, text: msg, callId: cid, done: false }]
          })
          return
        }

        if (level === 'llm' && cid) {
          if (msg.includes('推理完成') || msg.includes('汇总完成')) {
            setStreamEntries(prev =>
              prev.map(e => e.callId === cid ? { ...e, done: true } : e)
            )
          }
          // Don't show verbose llm meta as activity items
          return
        }

        // All other events → activity feed
        const SHOW_LEVELS = ['tool', 'start', 'success', 'fail', 'reject', 'info']
        if (SHOW_LEVELS.includes(level)) {
          setActivityItems(prev => [
            ...prev,
            { id: `${Date.now()}-${Math.random()}`, level, message: msg, stageKey: sk, time },
          ])
        }
      } catch { /* ignore malformed */ }
    }

    return () => { es.close(); esRef.current = null }
  }, [runId, reset])

  return { streamEntries, activityItems }
}

// ─── Main component ────────────────────────────────────────────────────────────

export function DetailView({
  stages, artifacts, runStatus, runId, elapsed, selectedStageKey,
  onSelectArtifact, onShowOverview,
}: DetailViewProps) {
  const [tab, setTab] = useState<TabKey>('progress')
  const { data: tokenUsage = {} } = useRunTokenUsage(runId)
  const { streamEntries, activityItems } = useStageStream(runId)
  const { retryStage } = useRunActions()

  const displayStage = useMemo(() => {
    if (selectedStageKey) {
      const found = stages.find(s => s.stage_key === selectedStageKey)
      if (found) return found
    }
    const running = stages.find(s => s.status === 'running')
    if (running) return running
    const lastFinished = [...stages].reverse().find(s => s.status === 'succeeded' || s.status === 'failed')
    return lastFinished ?? stages[0]
  }, [stages, selectedStageKey])

  const stageDef = STAGES.find(s => s.key === displayStage?.stage_key)
  const stageIndex = stageDef?.index ?? 1
  const persona = getPersona(displayStage?.stage_key)
  const hue = HUE_TOKENS[persona.hue]
  const isRunning = displayStage?.status === 'running'
  const stageArtifacts = artifacts.filter(a => a.stage_key === displayStage?.stage_key)
  const tabArtifacts = artifacts.filter(a => a.stage_key === displayStage?.stage_key)

  const runIsTerminal = ['completed', 'failed', 'terminated'].includes(runStatus)
  const stageIsRetryable =
    !!displayStage &&
    runIsTerminal &&
    ['failed', 'rejected', 'succeeded'].includes(displayStage.status)
  const retryDisabled = retryStage.isPending || !stageIsRetryable

  const handleRetry = () => {
    if (!runId || !displayStage || retryDisabled) return
    const label = STAGES.find(s => s.key === displayStage.stage_key)?.label || displayStage.stage_key
    if (!window.confirm(`从「${label}」开始重跑流水线？后续阶段会被覆盖。`)) return
    retryStage.mutate({ runId, stageKey: displayStage.stage_key })
  }

  return (
    <div className="fade-up" style={{ maxWidth: 920, margin: '0 auto' }}>
      {/* BACK + CONTEXT */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={onShowOverview}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '7px 14px 7px 11px',
            background: 'white', border: '1px solid var(--c-line-2)', borderRadius: 10,
            fontSize: 12.5, fontWeight: 500, color: 'var(--c-ink-700)',
            cursor: 'pointer', transition: 'all 0.2s var(--c-ease)',
            boxShadow: 'var(--c-shadow-sm)', fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--c-ink-900)'
            e.currentTarget.style.borderColor = hue.solid
            e.currentTarget.style.transform = 'translateX(-2px)'
            e.currentTarget.style.boxShadow = 'var(--c-shadow-md)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--c-ink-700)'
            e.currentTarget.style.borderColor = 'var(--c-line-2)'
            e.currentTarget.style.transform = 'translateX(0)'
            e.currentTarget.style.boxShadow = 'var(--c-shadow-sm)'
          }}
        >
          <ArrowLeft size={13} strokeWidth={2} />
          返回总览
        </button>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 12px 5px 8px',
          background: 'var(--c-ink-50)', borderRadius: 999,
          fontSize: 11.5, color: 'var(--c-ink-500)',
        }}>
          {isRunning && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: hue.solid }}
              className="animate-breathe" />
          )}
          <span>Stage {stageIndex} ·</span>
          <span className="mono" style={{ color: 'var(--c-ink-700)', fontWeight: 500 }}>
            {formatTimeShort(elapsed)}
          </span>
          <span>elapsed</span>
        </div>

        {stageIsRetryable && (
          <button
            onClick={handleRetry}
            disabled={retryDisabled}
            title={
              displayStage?.status === 'failed'
                ? '从此阶段重试，沿用前序产物'
                : '从此阶段重跑（覆盖后续阶段产物）'
            }
            style={{
              marginLeft: 'auto',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px 6px 10px',
              background: displayStage?.status === 'failed' ? '#FEF2F2' : 'white',
              border: `1px solid ${displayStage?.status === 'failed' ? '#FECACA' : 'var(--c-line-2)'}`,
              borderRadius: 10,
              fontSize: 12, fontWeight: 500,
              color: displayStage?.status === 'failed' ? '#B91C1C' : 'var(--c-ink-700)',
              cursor: retryDisabled ? 'not-allowed' : 'pointer',
              opacity: retryDisabled ? 0.55 : 1,
              transition: 'all 0.18s ease',
              boxShadow: 'var(--c-shadow-sm)', fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (retryDisabled) return
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = 'var(--c-shadow-md)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = 'var(--c-shadow-sm)'
            }}
          >
            <RotateCcw size={12} strokeWidth={2} />
            {retryStage.isPending ? '正在重启…' : '重试此阶段'}
          </button>
        )}
      </div>
      {retryStage.isError && (
        <div style={{
          marginTop: -16, marginBottom: 16,
          padding: '8px 14px',
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 10, fontSize: 12, color: '#B91C1C',
        }}>
          重试失败：{(retryStage.error as Error)?.message || '请检查后端日志'}
        </div>
      )}

      {/* TABS */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
        <div style={{
          display: 'flex', gap: 4, padding: 5,
          background: 'var(--c-ink-50)', border: '1px solid var(--c-line)', borderRadius: 12,
        }}>
          <Tab active={tab === 'progress'} onClick={() => setTab('progress')} icon={<Activity size={13} strokeWidth={1.8} />} label="阶段进度" />
          <Tab active={tab === 'artifacts'} onClick={() => setTab('artifacts')} icon={<FileIcon size={13} strokeWidth={1.8} />} label="产物" badge={tabArtifacts.length || undefined} />
          <Tab active={tab === 'logs'} onClick={() => setTab('logs')} icon={<Terminal size={13} strokeWidth={1.8} />} label="日志" />
        </div>
      </div>

      {/* TAB CONTENT */}
      {tab === 'progress' && (
        <ProgressTab
          stage={displayStage}
          artifacts={stageArtifacts}
          streamEntries={streamEntries}
          activityItems={activityItems}
          tokenUsage={tokenUsage}
          onSelectArtifact={onSelectArtifact}
        />
      )}

      {tab === 'artifacts' && (
        <ArtifactsTab artifacts={tabArtifacts} onSelectArtifact={onSelectArtifact} />
      )}

      {tab === 'logs' && (
        <div style={{
          background: 'white', border: '1px solid var(--c-line-2)',
          borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--c-shadow-sm)', height: 460,
        }}>
          <LogStream stages={stages} runStatus={runStatus} runId={runId} />
        </div>
      )}
    </div>
  )
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function Tab({ active, onClick, icon, label, badge }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '7px 14px', borderRadius: 8, fontSize: 12.5,
        color: active ? 'var(--c-ink-900)' : 'var(--c-ink-500)',
        fontWeight: active ? 500 : 400,
        background: active ? 'white' : 'transparent',
        boxShadow: active ? 'var(--c-shadow-sm)' : 'none',
        border: 'none', cursor: 'pointer', transition: 'all 0.2s ease', fontFamily: 'inherit',
      }}
    >
      {icon}
      {label}
      {badge != null && (
        <span style={{
          padding: '1px 6px', background: 'var(--c-ink-100)', borderRadius: 999,
          fontSize: 9.5, fontWeight: 600, color: 'var(--c-ink-600)',
        }}>{badge}</span>
      )}
    </button>
  )
}

// ─── Progress tab ─────────────────────────────────────────────────────────────

const ACTIVITY_STYLE: Record<string, { icon: string; color: string; bg: string }> = {
  tool:    { icon: '⚙', color: '#0369A1', bg: 'rgba(14,165,233,0.07)' },
  start:   { icon: '▶', color: '#1D4ED8', bg: 'rgba(59,130,246,0.06)' },
  success: { icon: '✓', color: '#047857', bg: 'rgba(16,185,129,0.06)' },
  fail:    { icon: '✗', color: '#B91C1C', bg: 'rgba(239,68,68,0.06)'  },
  reject:  { icon: '↩', color: '#B45309', bg: 'rgba(245,158,11,0.06)' },
  info:    { icon: '·', color: '#64748B', bg: 'transparent'           },
}

function ProgressTab({ stage, artifacts, streamEntries, activityItems, tokenUsage, onSelectArtifact }: {
  stage: StageResult | undefined
  artifacts: Artifact[]
  streamEntries: StreamEntry[]
  activityItems: ActivityItem[]
  tokenUsage: Record<string, number>
  onSelectArtifact: (a: Artifact) => void
}) {
  const persona = getPersona(stage?.stage_key)
  const hue = HUE_TOKENS[persona.hue]
  const stageDef = STAGES.find(s => s.key === stage?.stage_key)
  const stageIndex = stageDef?.index ?? 1
  const isRunning = stage?.status === 'running'
  const isSucceeded = stage?.status === 'succeeded'
  const titleLines = persona.heroTitle.split('\n')
  const stageKey = stage?.stage_key || ''
  const primaryArtifact = useMemo(
    () => primaryArtifactForStage(stageKey, artifacts),
    [stageKey, artifacts],
  )
  const [artifactContent, setArtifactContent] = useState('')
  const [artifactContentId, setArtifactContentId] = useState<string | null>(null)

  // Filter stream data for this stage
  const stageStream = streamEntries.filter(e => e.stageKey === stageKey)
  const fullContent = stageStream.map(e => e.text).join('\n\n')
  const isStreaming = stageStream.some(e => !e.done)
  const hasStreamContent = fullContent.trim().length > 0
  const hasArtifactContent = !!primaryArtifact && artifactContentId === primaryArtifact.id && artifactContent.trim().length > 0
  const hasContent = hasStreamContent || hasArtifactContent

  // Filter activity for this stage (or global messages with empty stage_key)
  const stageActivity = activityItems.filter(a => a.stageKey === stageKey || a.stageKey === '')

  // Token count from backend
  const tokens = tokenUsage[stageKey] ?? 0

  useEffect(() => {
    if (!primaryArtifact) {
      setArtifactContent('')
      setArtifactContentId(null)
      return
    }
    let cancelled = false
    setArtifactContent('加载中…')
    setArtifactContentId(primaryArtifact.id)
    apiClient.getArtifactContent(primaryArtifact).then(data => {
      if (!cancelled) setArtifactContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
    }).catch(() => {
      if (!cancelled) setArtifactContent('产物内容加载失败。')
    })
    return () => { cancelled = true }
  }, [primaryArtifact])

  // Auto-scroll content area
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [fullContent, isStreaming])

  // Activity scroll
  const activityRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight
    }
  }, [stageActivity.length])

  return (
    <>
      {/* ── HERO HEADLINE ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          marginBottom: 14, fontSize: 11.5, color: 'var(--c-ink-500)',
        }}>
          <span className="mono" style={{
            padding: '3px 9px',
            background: hue.softBg, border: `1px solid ${hue.softBorder}`,
            borderRadius: 999, color: hue.solidDark, fontWeight: 600, fontSize: 10.5,
          }}>
            STAGE {String(stageIndex).padStart(2, '0')}
          </span>
          <span>{persona.name} · {persona.role}</span>
        </div>

        <h1 className="display" style={{
          fontSize: 46, fontWeight: 700, color: 'var(--c-ink-900)',
          lineHeight: 1.05, marginBottom: 12, letterSpacing: '-0.035em',
        }}>
          {titleLines[0]}
          <br />
          <span key={stage?.stage_key} style={{
            backgroundImage: hue.heroGradient,
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            WebkitTextFillColor: 'transparent', display: 'inline-block',
          }}>
            {titleLines[1] || ''}
          </span>
        </h1>

        <p className="serif" style={{ fontSize: 17, color: 'var(--c-ink-500)' }}>
          {persona.statusVerb}
        </p>
      </div>

      {/* ── MAIN CONTENT CARD ── */}
      <div style={{
        background: 'white', border: '1px solid var(--c-line-2)',
        borderRadius: 18, overflow: 'hidden',
        boxShadow: 'var(--c-shadow-md)', marginBottom: 14,
      }}>
        {/* Card header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '11px 18px', background: 'var(--c-ink-50)',
          borderBottom: '1px solid var(--c-line)',
        }}>
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', background: hue.solid }}
            className={isRunning ? 'animate-ripple' : ''}
          />
          <span style={{
            fontSize: 10.5, fontWeight: 600, color: 'var(--c-ink-500)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {persona.name} · {isRunning ? '实时输出' : isSucceeded ? '阶段产出' : '等待中'}
          </span>

          {isStreaming && (
            <span style={{
              marginLeft: 'auto', fontSize: 11, color: hue.solidDark,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span
                className="animate-breathe"
                style={{ width: 6, height: 6, borderRadius: '50%', background: hue.solid }}
              />
              生成中…
            </span>
          )}

          {!isRunning && !isStreaming && hasContent && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#047857' }}>
              ✓ {primaryArtifact ? artifactLabel(primaryArtifact.filename) : '完成'}
            </span>
          )}
        </div>

        {/* Streaming / completed content */}
        <div
          ref={contentRef}
          style={{
            maxHeight: 340, overflowY: 'auto',
            padding: hasArtifactContent ? 0 : '18px 22px',
            fontSize: 14, lineHeight: 1.8, color: 'var(--c-ink-800)',
            wordBreak: 'break-word',
          }}
        >
          {hasStreamContent ? (
            <>
              <ArtifactContentView filename={`${stageKey}.md`} content={fullContent} variant="light" compact />
              {isStreaming && (
                <span
                  style={{
                    display: 'inline-block', width: 8, height: 18,
                    background: hue.solid, verticalAlign: -3,
                    marginLeft: 3, borderRadius: 1,
                  }}
                  className="animate-blink"
                />
              )}
            </>
          ) : hasArtifactContent && primaryArtifact ? (
            <ArtifactContentView filename={primaryArtifact.filename} content={artifactContent} variant="light" compact />
          ) : isRunning ? (
            <span style={{ color: 'var(--c-ink-400)', fontSize: 13.5, fontFamily: 'Inter', fontStyle: 'italic' }}>
              {persona.statusVerb}…
              <span
                style={{
                  display: 'inline-block', width: 8, height: 18,
                  background: hue.solid, verticalAlign: -3, marginLeft: 6, borderRadius: 1,
                }}
                className="animate-blink"
              />
            </span>
          ) : isSucceeded ? (
            <span style={{ color: 'var(--c-ink-500)', fontFamily: 'Inter', fontSize: 13.5 }}>
              ✓ {persona.name} 已完成此阶段，共耗时 {formatDur(stage?.duration_seconds || 0)}，
              产出 {artifacts.length} 个文件。
              {artifacts.length > 0 && (
                <> 点击下方产物查看完整内容。</>
              )}
            </span>
          ) : stage?.error_message ? (
            <span style={{ color: '#B91C1C', fontFamily: 'Inter', fontSize: 13.5 }}>
              ✗ {stage.error_message}
            </span>
          ) : (
            <span style={{ color: 'var(--c-ink-400)', fontFamily: 'Inter', fontSize: 13.5, fontStyle: 'italic' }}>
              等待启动…
            </span>
          )}
        </div>

        {/* Activity feed */}
        {stageActivity.length > 0 && (
          <div style={{ borderTop: '1px solid var(--c-line)' }}>
            <div
              ref={activityRef}
              style={{ maxHeight: 160, overflowY: 'auto', padding: '10px 18px 12px' }}
            >
              <div style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.09em', color: 'var(--c-ink-400)', marginBottom: 8,
              }}>
                活动记录
              </div>
              {stageActivity.map(a => {
                const cfg = ACTIVITY_STYLE[a.level] || ACTIVITY_STYLE.info
                return (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                      marginBottom: 4, padding: '3px 7px', borderRadius: 6,
                      background: cfg.bg, fontSize: 12.5,
                    }}
                  >
                    <span style={{ color: cfg.color, flexShrink: 0, width: 14, textAlign: 'center', fontWeight: 600, fontSize: 13 }}>
                      {cfg.icon}
                    </span>
                    <span style={{ color: 'var(--c-ink-700)', flex: 1, lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {a.message}
                    </span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--c-ink-400)', flexShrink: 0, paddingTop: 1 }}>
                      {a.time}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 18px', borderTop: '1px solid var(--c-line)',
          background: 'var(--c-ink-50)', fontSize: 11.5, color: 'var(--c-ink-500)',
        }}>
          <span className="mono">{stage?.provider || '—'} · attempt {stage?.attempt || 1}</span>
          {(stage?.duration_seconds ?? 0) > 0 && (
            <span className="mono">{formatDur(stage!.duration_seconds!)}</span>
          )}
        </div>
      </div>

      {/* ── TOKEN 消耗 CARD ── */}
      {stage?.provider && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'white', border: '1px solid var(--c-line-2)',
          borderRadius: 14, padding: '14px 20px',
          boxShadow: 'var(--c-shadow-sm)', marginBottom: 14,
        }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.10em', color: 'var(--c-ink-400)', marginBottom: 6,
            }}>
              TOKEN 消耗
            </div>

            {tokens > 0 ? (
              <div className="mono" style={{
                fontSize: 34, fontWeight: 800, color: 'var(--c-ink-900)',
                lineHeight: 1, letterSpacing: '-0.04em',
              }}>
                {tokens >= 1_000_000
                  ? <>{(tokens / 1_000_000).toFixed(1)}<span style={{ fontSize: 18, fontWeight: 600, color: 'var(--c-ink-500)', marginLeft: 1 }}>M</span></>
                  : tokens >= 1000
                    ? <>{(tokens / 1000).toFixed(1)}<span style={{ fontSize: 18, fontWeight: 600, color: 'var(--c-ink-500)', marginLeft: 1 }}>k</span></>
                    : tokens
                }
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--c-ink-400)', fontStyle: 'italic', lineHeight: 1.6 }}>
                等待中…
              </div>
            )}

            <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-ink-500)', marginTop: 5 }}>
              {stage?.provider} · {
                (() => {
                  const m = stage?.model || 'default'
                  if (m.startsWith('ep-') && m.length > 20) return m.slice(0, 10) + '…' + m.slice(-6)
                  return m.length > 24 ? m.slice(0, 24) + '…' : m
                })()
              }
            </div>
          </div>

          <div style={{
            width: 46, height: 46, borderRadius: 12,
            background: tokens > 0 ? hue.softBg : 'var(--c-ink-50)',
            border: `1px solid ${tokens > 0 ? hue.softBorder : 'var(--c-line)'}`,
            display: 'grid', placeItems: 'center',
          }}>
            <Zap size={20} strokeWidth={1.8}
              style={{ color: tokens > 0 ? hue.solidDark : 'var(--c-ink-400)' }} />
          </div>
        </div>
      )}

      {/* ── ARTIFACTS ── */}
      {artifacts.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{
            fontSize: 11, color: 'var(--c-ink-500)', textTransform: 'uppercase',
            letterSpacing: '0.10em', fontWeight: 600, marginBottom: 10,
          }}>
            本阶段产物
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {artifacts.map(a => (
              <ArtifactRow key={a.id} artifact={a} onClick={() => onSelectArtifact(a)} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Artifacts tab ─────────────────────────────────────────────────────────────

function ArtifactsTab({ artifacts, onSelectArtifact }: {
  artifacts: Artifact[]
  onSelectArtifact: (a: Artifact) => void
}) {
  if (artifacts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--c-ink-400)' }}>
        <div className="serif" style={{ fontSize: 18, fontStyle: 'italic' }}>此阶段尚未生成产物</div>
        <div style={{ fontSize: 12.5, marginTop: 8 }}>阶段完成后产物会出现在这里</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {artifacts.map(a => (
        <ArtifactRow key={a.id} artifact={a} onClick={() => onSelectArtifact(a)} />
      ))}
    </div>
  )
}

// ─── Artifact row ──────────────────────────────────────────────────────────────

function ArtifactRow({ artifact, onClick }: { artifact: Artifact; onClick: () => void }) {
  const label = artifactLabel(artifact.filename)
  const isMapped = label !== artifact.filename

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 16px', background: 'white',
        border: '1px solid var(--c-line-2)', borderRadius: 10,
        cursor: 'pointer', transition: 'all 0.2s ease',
        textAlign: 'left', fontFamily: 'inherit', width: '100%',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-ink-300)'
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = 'var(--c-shadow-sm)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-line-2)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{
        width: 28, height: 28, display: 'grid', placeItems: 'center',
        background: 'var(--c-ink-100)', borderRadius: 6,
        color: 'var(--c-ink-500)', flexShrink: 0,
      }}>
        <FileCode2 size={14} strokeWidth={1.7} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: 'var(--c-ink-900)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label}
        </div>
        {isMapped && (
          <div className="mono" style={{
            fontSize: 10.5, color: 'var(--c-ink-400)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {artifact.filename}
          </div>
        )}
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--c-ink-400)', flexShrink: 0 }}>
        {(artifact.size_bytes / 1024).toFixed(1)} KB
      </span>
    </button>
  )
}
