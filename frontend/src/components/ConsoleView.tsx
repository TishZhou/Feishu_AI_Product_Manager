import { useEffect, useState, useMemo } from 'react'
import { Play, Pause, Square, Search, Bell, Activity, ChevronRight, LayoutDashboard, GitBranch } from 'lucide-react'
import { useRun, useRunStages, useRunActions, useRunArtifacts, useRunCheckpoints, useRunTokenUsage, useGitStatus } from '../hooks/useDevFlow'
import { PipelineGraph } from './PipelineGraph'
import { OverviewView } from './OverviewView'
import { DetailView } from './DetailView'
import { UICanvasView } from './UICanvasView'
import { CheckpointModal } from './CheckpointModal'
import { ClarificationModal } from './ClarificationModal'
import { ArtifactViewer } from './ArtifactViewer'
import { GitIntegrationModal } from './GitIntegrationModal'
import { getPersona, HUE_TOKENS } from '../data/personas'
import type { Artifact, RunStatus } from '../types/api'

interface ConsoleViewProps {
  runId: string
  onBack: () => void
}

type ViewMode = 'overview' | 'detail' | 'canvas'

const STATUS_LABEL: Record<RunStatus, string> = {
  created: '已创建', running: '运行中', waiting_for_approval: '待审核',
  waiting_for_clarification: '待澄清',
  paused: '已暂停', completed: '已完成', failed: '已失败', terminated: '已终止',
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

export function ConsoleView({ runId, onBack }: ConsoleViewProps) {
  const { data: run } = useRun(runId)
  const { data: stages = [] } = useRunStages(runId)
  const { data: artifacts = [] } = useRunArtifacts(runId)
  const { data: checkpoints = [] } = useRunCheckpoints(runId)
  const { data: tokenUsage = {} } = useRunTokenUsage(runId)
  const { pause, resume, terminate } = useRunActions()

  const [view, setView] = useState<ViewMode>('overview')
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [hasTransitioned, setHasTransitioned] = useState(false)
  const [dismissedClarificationRunId, setDismissedClarificationRunId] = useState<string | null>(null)
  const [gitModalOpen, setGitModalOpen] = useState(false)
  const [gitAutoShownForRun, setGitAutoShownForRun] = useState<string | null>(null)

  useEffect(() => {
    setDismissedClarificationRunId(null)
    setGitAutoShownForRun(null)
    setGitModalOpen(false)
  }, [runId])

  // Live timer
  useEffect(() => {
    if (run?.started_at && !run.completed_at) {
      const start = new Date(run.started_at).getTime()
      const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
      tick()
      const t = setInterval(tick, 1000)
      return () => clearInterval(t)
    } else if (run?.completed_at && run?.started_at) {
      setElapsed(Math.floor((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000))
    }
  }, [run?.started_at, run?.completed_at])

  // ESC closes detail/canvas back to overview
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (view === 'detail' || view === 'canvas')) {
        setView('overview'); setHasTransitioned(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view])

  const activeRunningStage = useMemo(() => stages.find(s => s.status === 'running'), [stages])
  const headerStageKey = activeRunningStage?.stage_key
    || [...stages].reverse().find(s => s.status === 'succeeded' || s.status === 'failed')?.stage_key
    || null
  const headerPersona = getPersona(headerStageKey)
  const headerHue = HUE_TOKENS[headerPersona.hue]

  const showDetail = () => { setView('detail'); setHasTransitioned(true) }
  const showOverview = () => { setView('overview'); setHasTransitioned(true) }

  const handleStageClick = (key: string) => { setSelectedStageKey(key); showDetail() }

  // Pre-fetch git status once the run completes — drives the auto-show modal
  // and the header pill. Disabled while the run is still running so we don't
  // spam the endpoint mid-pipeline.
  const { data: gitStatus } = useGitStatus(runId, run?.status === 'completed')

  // Auto-open the git integration modal the first time a completed run is
  // viewed AND we have a git repo with no prior publication. The user can
  // dismiss; the dismissal sticks until they manually re-open or switch runs.
  useEffect(() => {
    if (!run || run.status !== 'completed' || !runId) return
    if (gitAutoShownForRun === runId) return
    if (!gitStatus || !gitStatus.is_git || gitStatus.already_published) return
    setGitModalOpen(true)
    setGitAutoShownForRun(runId)
  }, [run, runId, gitStatus, gitAutoShownForRun])

  if (!run) return null

  const activeCheckpoint = checkpoints.find(c => c.status === 'waiting')
  const showCheckpoint = run.status === 'waiting_for_approval' && activeCheckpoint
  const showClarification = run.status === 'waiting_for_clarification' && dismissedClarificationRunId !== runId
  const isActive = ['running', 'paused', 'waiting_for_approval', 'waiting_for_clarification'].includes(run.status)
  const isCompleted = run.status === 'completed'

  return (
    <div className="console-root" style={{
      height: '100vh', width: '100vw',
      background: 'var(--c-bg)',
      color: 'var(--c-ink-900)',
      display: 'grid',
      gridTemplateColumns: '248px 1fr',
      gridTemplateRows: '60px 1fr',
      gridTemplateAreas: '"head head" "side main"',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* AURORA */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div className="aurora-blob" style={{
          position: 'absolute', width: 540, height: 540,
          background: `radial-gradient(circle at center, rgba(${headerHue.pulseRGB}, 0.18), transparent 70%)`,
          top: -180, left: '35%', borderRadius: '50%', filter: 'blur(80px)',
          transition: 'background 1s ease',
        }} />
        <div className="aurora-blob" style={{
          position: 'absolute', width: 460, height: 460,
          background: 'radial-gradient(circle at center, rgba(147, 197, 253, 0.20), transparent 70%)',
          bottom: -160, right: '8%', borderRadius: '50%', filter: 'blur(80px)', animationDelay: '-7s',
        }} />
        <div className="aurora-blob" style={{
          position: 'absolute', width: 380, height: 380,
          background: `radial-gradient(circle at center, rgba(${headerHue.pulseRGB}, 0.20), transparent 70%)`,
          top: '35%', left: -120, borderRadius: '50%', filter: 'blur(80px)',
          animationDelay: '-14s', transition: 'background 1s ease',
        }} />
      </div>

      {/* ═════ HEADER ═════ */}
      <header style={{
        gridArea: 'head',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px',
        borderBottom: '1px solid var(--c-line)',
        background: 'rgba(252, 253, 254, 0.85)',
        backdropFilter: 'saturate(180%) blur(12px)',
        WebkitBackdropFilter: 'saturate(180%) blur(12px)',
        zIndex: 10, position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Brand */}
          <button
            onClick={onBack}
            className="fade-up"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, animationDelay: '0.05s',
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
              display: 'grid', placeItems: 'center',
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.20)',
              position: 'relative', overflow: 'hidden',
            }}>
              <Activity size={14} color="white" strokeWidth={2.5} />
              <div className="animate-hero-shine" style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(45deg, transparent 30%, rgba(255, 255, 255, 0.20) 50%, transparent 70%)',
                transform: 'translateX(-100%)',
              }} />
            </div>
            <span className="display" style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-ink-900)' }}>DevFlow</span>
            <span style={{ fontSize: 13, color: 'var(--c-ink-400)', fontWeight: 400, marginLeft: -2 }}>Engine</span>
          </button>

          <div style={{ width: 1, height: 20, background: 'var(--c-line-2)' }} />

          {/* Breadcrumb */}
          <div className="fade-up" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: 'var(--c-ink-500)', animationDelay: '0.1s',
          }}>
            <span>Workspace</span>
            <ChevronRight size={12} style={{ opacity: 0.4 }} />
            <span>Runs</span>
            <ChevronRight size={12} style={{ opacity: 0.4 }} />
            <span style={{ color: 'var(--c-ink-900)', fontWeight: 500 }}>运行 #{run.run_number}</span>
            {view === 'detail' && (
              <>
                <ChevronRight size={12} style={{ opacity: 0.4 }} />
                <span
                  onClick={showOverview}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '2px 9px', color: headerHue.solidDark, fontWeight: 500,
                    cursor: 'pointer', background: headerHue.softBg,
                    borderRadius: 6, border: `1px solid ${headerHue.softBorder}`,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {headerPersona.name} · {headerPersona.role.split(' ')[0]}
                </span>
              </>
            )}
            {view === 'canvas' && (
              <>
                <ChevronRight size={12} style={{ opacity: 0.4 }} />
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '2px 9px', color: '#7C3AED', fontWeight: 500,
                  background: 'rgba(124,58,237,0.08)',
                  borderRadius: 6, border: '1px solid rgba(124,58,237,0.20)',
                }}>
                  <LayoutDashboard size={11} /> 前端 Canvas
                </span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Status + timer pill */}
          <div className="fade-up mono" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', background: 'var(--c-ink-50)',
            borderRadius: 999, fontSize: 12, color: 'var(--c-ink-700)',
            fontFeatureSettings: '"tnum"', animationDelay: '0.15s',
          }}>
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: run.status === 'running' ? headerHue.solid
                  : run.status === 'waiting_for_approval' || run.status === 'waiting_for_clarification' ? '#F59E0B'
                  : run.status === 'completed' ? '#10B981'
                  : run.status === 'failed' || run.status === 'terminated' ? '#EF4444'
                  : 'var(--c-ink-300)',
              }}
              className={run.status === 'running' ? 'animate-breathe' : ''}
            />
            <span style={{ fontFamily: 'Inter', fontSize: 11.5 }}>{STATUS_LABEL[run.status]}</span>
            <span style={{ color: 'var(--c-ink-300)' }}>·</span>
            <span>{formatTime(elapsed)}</span>
          </div>

          {run.status === 'running' && (
            <button
              onClick={() => pause.mutate(run.id)}
              style={{ ...iconBtnStyle }}
              onMouseEnter={iconBtnHover} onMouseLeave={iconBtnLeave}
            >
              <Pause size={13} strokeWidth={1.8} />
            </button>
          )}
          {run.status === 'paused' && (
            <button
              onClick={() => resume.mutate(run.id)}
              style={{
                width: 32, height: 32, display: 'grid', placeItems: 'center',
                background: headerHue.softBg, border: `1px solid ${headerHue.softBorder}`,
                borderRadius: 8, color: headerHue.solidDark, cursor: 'pointer',
                transition: 'all 0.2s var(--c-ease)',
              }}
            >
              <Play size={13} strokeWidth={1.8} />
            </button>
          )}
          {isActive && (
            <button
              onClick={() => terminate.mutate(run.id)}
              style={{ ...iconBtnStyle }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.06)'
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.20)'
                e.currentTarget.style.color = '#DC2626'
              }}
              onMouseLeave={iconBtnLeave}
            >
              <Square size={13} strokeWidth={1.8} />
            </button>
          )}

          {/* Git integration trigger — visible after the run completes; lights up
              when there's a real git repo and we haven't pushed yet. */}
          {isCompleted && gitStatus?.is_git && (
            <button
              onClick={() => setGitModalOpen(true)}
              title={gitStatus.already_published ? '已推送过 — 点击查看 / 重新发起' : '推送到 git / 创建 PR'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 11px',
                background: gitStatus.already_published ? 'var(--c-ink-50)' : 'rgba(59,130,246,0.08)',
                border: `1px solid ${gitStatus.already_published ? 'var(--c-line-2)' : 'rgba(59,130,246,0.22)'}`,
                borderRadius: 8,
                color: gitStatus.already_published ? 'var(--c-ink-700)' : '#1D4ED8',
                cursor: 'pointer', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.18s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.06)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <GitBranch size={13} strokeWidth={2} />
              <span>{gitStatus.already_published ? '已推送' : 'Git'}</span>
            </button>
          )}

          <div style={{ width: 1, height: 20, background: 'var(--c-line-2)' }} />

          <button style={{ ...iconBtnStyle }} onMouseEnter={iconBtnHover} onMouseLeave={iconBtnLeave}>
            <Search size={13} strokeWidth={1.8} />
          </button>
          <button style={{ ...iconBtnStyle }} onMouseEnter={iconBtnHover} onMouseLeave={iconBtnLeave}>
            <Bell size={13} strokeWidth={1.8} />
          </button>

          <div className="fade-up" style={{
            width: 30, height: 30, borderRadius: '50%',
            background: headerHue.avatarGradient,
            display: 'grid', placeItems: 'center',
            color: 'white', fontWeight: 700, fontSize: 11,
            boxShadow: `0 0 0 2px white, 0 0 0 3px var(--c-line-2)`,
            cursor: 'pointer', animationDelay: '0.2s',
            transition: 'box-shadow 0.2s ease',
          }}>{headerPersona.initial}</div>
        </div>
      </header>

      {/* ═════ SIDEBAR ═════ */}
      <aside style={{
        gridArea: 'side',
        background: 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'saturate(180%) blur(12px)',
        WebkitBackdropFilter: 'saturate(180%) blur(12px)',
        borderRight: '1px solid var(--c-line)',
        padding: '20px 14px',
        display: 'flex', flexDirection: 'column', gap: 6,
        overflowY: 'auto', position: 'relative', zIndex: 1,
      }}>
        <div className="fade-up" style={{ animationDelay: '0.1s' }}>
          <div style={{
            background: 'var(--c-ink-50)', borderRadius: 12, padding: 6,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 8,
              background: 'white', border: '1px solid var(--c-line-2)',
              boxShadow: 'var(--c-shadow-sm)', fontSize: 13,
              color: 'var(--c-ink-900)', fontWeight: 500,
            }}>
              <Activity size={13} strokeWidth={1.7} />
              当前流水线
            </div>
          </div>
        </div>

        <div style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--c-ink-400)',
          padding: '16px 10px 6px',
        }}>
          流水线阶段
        </div>

        <div className="fade-up" style={{ animationDelay: '0.2s' }}>
          <PipelineGraph
            stages={stages} runStatus={run.status}
            selectedStageKey={selectedStageKey} onStageClick={handleStageClick}
          />
        </div>

        <div style={{ flex: 1, minHeight: 16 }} />

        {/* UI Canvas entry */}
        <div className="fade-up" style={{ animationDelay: '0.25s' }}>
          <button
            onClick={() => { setView('canvas'); setHasTransitioned(true) }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 10px', borderRadius: 9, cursor: 'pointer',
              background: view === 'canvas' ? 'rgba(124,58,237,0.08)' : 'transparent',
              border: view === 'canvas' ? '1px solid rgba(124,58,237,0.22)' : '1px solid transparent',
              color: view === 'canvas' ? '#7C3AED' : 'var(--c-ink-600)',
              fontFamily: 'inherit', fontSize: 13, fontWeight: view === 'canvas' ? 600 : 500,
              textAlign: 'left', transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              if (view !== 'canvas') {
                e.currentTarget.style.background = 'rgba(124,58,237,0.05)'
                e.currentTarget.style.borderColor = 'rgba(124,58,237,0.15)'
                e.currentTarget.style.color = '#7C3AED'
              }
            }}
            onMouseLeave={e => {
              if (view !== 'canvas') {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'transparent'
                e.currentTarget.style.color = 'var(--c-ink-600)'
              }
            }}
          >
            <div style={{
              width: 24, height: 24, borderRadius: 7, flexShrink: 0,
              background: view === 'canvas' ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.08)',
              display: 'grid', placeItems: 'center',
              border: '1px solid rgba(124,58,237,0.18)',
            }}>
              <LayoutDashboard size={12} color="#7C3AED" />
            </div>
            <div>
              <div style={{ lineHeight: 1.3 }}>前端 Canvas</div>
              <div style={{ fontSize: 10.5, color: 'var(--c-ink-400)', fontWeight: 400, lineHeight: 1.2 }}>设计布局 → 生成代码</div>
            </div>
            {view === 'canvas' && (
              <div style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: '#7C3AED', flexShrink: 0 }} />
            )}
          </button>
        </div>

        <div style={{ height: 8 }} />

        {/* Upgrade card */}
        <div
          className="fade-up"
          style={{
            padding: 14, borderRadius: 12, cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--c-ink-50), white)',
            border: '1px solid var(--c-line-2)', transition: 'all 0.2s ease',
            animationDelay: '0.3s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--c-shadow-md)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
              display: 'grid', placeItems: 'center',
              boxShadow: '0 2px 8px rgba(59,130,246,0.30)', color: 'white', fontSize: 14,
            }}>◆</div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-ink-900)' }}>升级到 Pro</div>
              <div style={{ fontSize: 11, color: 'var(--c-ink-500)' }}>解锁更多 AI 算力</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ═════ MAIN — view switcher ═════ */}
      <main style={{ gridArea: 'main', position: 'relative', overflow: 'hidden', zIndex: 1 }}>
        {/* Overview layer */}
        <div style={{
          position: 'absolute', inset: 0, overflowY: 'auto',
          padding: '32px 56px 48px',
          opacity: view === 'overview' ? 1 : 0,
          transform: view === 'overview' ? 'translateY(0) scale(1)' : 'translateY(-24px) scale(1.015)',
          pointerEvents: view === 'overview' ? 'auto' : 'none',
          transition: 'opacity 0.55s var(--c-ease), transform 0.55s var(--c-ease)',
        }}>
          {(!hasTransitioned || view === 'overview') && (
            <OverviewView
              stages={stages} artifacts={artifacts} elapsed={elapsed}
              tokenUsage={tokenUsage} onShowDetail={showDetail}
            />
          )}
        </div>

        {/* Detail layer */}
        <div style={{
          position: 'absolute', inset: 0, overflowY: 'auto',
          padding: '32px 56px 48px',
          opacity: view === 'detail' ? 1 : 0,
          transform: view === 'detail' ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.985)',
          pointerEvents: view === 'detail' ? 'auto' : 'none',
          transition: 'opacity 0.55s var(--c-ease), transform 0.55s var(--c-ease)',
        }}>
          {view === 'detail' && (
            <DetailView
              stages={stages} artifacts={artifacts} runStatus={run.status}
              runId={runId} elapsed={elapsed} selectedStageKey={selectedStageKey}
              onSelectArtifact={setSelectedArtifact} onShowOverview={showOverview}
            />
          )}
        </div>

        {/* Canvas layer */}
        <div style={{
          position: 'absolute', inset: 0,
          opacity: view === 'canvas' ? 1 : 0,
          pointerEvents: view === 'canvas' ? 'auto' : 'none',
          transition: 'opacity 0.35s ease',
        }}>
          {view === 'canvas' && (
            <UICanvasView
              runId={runId}
              onBack={showOverview}
            />
          )}
        </div>
      </main>

      {/* MODALS */}
      {showCheckpoint && <CheckpointModal checkpoint={activeCheckpoint} artifacts={artifacts} />}
      {showClarification && (
        <ClarificationModal
          runId={runId}
          onSubmitted={() => setDismissedClarificationRunId(runId)}
        />
      )}
      <ArtifactViewer artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
      {gitModalOpen && (
        <GitIntegrationModal runId={runId} onClose={() => setGitModalOpen(false)} />
      )}
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: 32, height: 32, display: 'grid', placeItems: 'center',
  background: 'transparent', border: '1px solid transparent',
  borderRadius: 8, color: 'var(--c-ink-500)', cursor: 'pointer',
  transition: 'all 0.2s var(--c-ease)',
}
const iconBtnHover = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'var(--c-ink-50)'
  e.currentTarget.style.borderColor = 'var(--c-line-2)'
  e.currentTarget.style.color = 'var(--c-ink-900)'
}
const iconBtnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'transparent'
  e.currentTarget.style.borderColor = 'transparent'
  e.currentTarget.style.color = 'var(--c-ink-500)'
}
