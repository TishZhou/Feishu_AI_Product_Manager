import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, AlertTriangle, RotateCcw, FastForward, Cpu } from 'lucide-react'
import type { Checkpoint, Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { useCheckpointActions } from '../hooks/useDevFlow'
import { apiClient } from '../lib/api'
import { artifactLabel } from '../lib/artifactLabels'
import { ArtifactContentView } from './ArtifactContentView'

interface CheckpointModalProps {
  checkpoint: Checkpoint
  artifacts: Artifact[]
}

// Same options as SetupView's openai picker, plus "保持当前" sentinel.
const PROVIDER_OPTIONS = [
  { value: '', label: '保持当前' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'volcano', label: 'Volcano' },
]
const OPENAI_MODELS = [
  { value: '', label: '保持当前' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
]

const LABEL_TEXT: Record<string, { title: string; subtitle: string; approveText: string; rejectText: string; intent: 'review' | 'intervention' }> = {
  post_design_review: {
    title: '设计审核',
    subtitle: '请审阅前序需求与方案，确认无误后批准进入实现阶段',
    approveText: '批准并继续',
    rejectText: '驳回并重试',
    intent: 'review',
  },
  post_implementation_review: {
    title: '实现审核',
    subtitle: '请审阅生成的代码、测试结果与代码审查报告',
    approveText: '批准并继续',
    rejectText: '驳回并重试',
    intent: 'review',
  },
  pre_git_delivery: {
    title: '交付前确认',
    subtitle: '审阅最终补丁，批准后将应用到源仓库',
    approveText: '批准并交付',
    rejectText: '驳回并重试',
    intent: 'review',
  },
  test_failure_intervention: {
    title: '测试持续失败',
    subtitle: 'AI 自动重试已达上限。可以跳过这次测试，或给出修复指引让 AI 再试',
    approveText: '跳过失败的测试',
    rejectText: '带指引重新生成',
    intent: 'intervention',
  },
  review_blocker_intervention: {
    title: '代码审查未通过',
    subtitle: 'BLOCKER 问题在多次自动重试后仍未解决。可跳过审查继续，或给出指引让 AI 修正',
    approveText: '跳过 BLOCKER 继续',
    rejectText: '带指引让 AI 修正',
    intent: 'intervention',
  },
}

function meta(checkpoint: Checkpoint) {
  return LABEL_TEXT[checkpoint.label] ?? {
    title: '人工审核',
    subtitle: `检查点 #${checkpoint.checkpoint_number}`,
    approveText: '批准并继续',
    rejectText: '驳回并重试',
    intent: 'review' as const,
  }
}

export function CheckpointModal({ checkpoint, artifacts }: CheckpointModalProps) {
  const { approve, reject } = useCheckpointActions()
  const [reason, setReason] = useState('')
  const [retryStage, setRetryStage] = useState(checkpoint.retry_stage_key)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [nextProvider, setNextProvider] = useState('')
  const [nextModel, setNextModel] = useState('')
  const [customModel, setCustomModel] = useState('')

  // When user changes provider, clear stale model selection.
  useEffect(() => {
    setNextModel('')
    setCustomModel('')
  }, [nextProvider])

  const cpMeta = meta(checkpoint)
  const isIntervention = cpMeta.intent === 'intervention'

  const requiredStages = useMemo(
    () => JSON.parse(checkpoint.required_stage_keys) as string[],
    [checkpoint.required_stage_keys]
  )
  const relevantArtifacts = useMemo(
    () => artifacts.filter(a => requiredStages.includes(a.stage_key)),
    [artifacts, requiredStages]
  )

  useEffect(() => {
    if (relevantArtifacts.length > 0 && !activeArtifactId) {
      setActiveArtifactId(relevantArtifacts[0].id)
    }
  }, [relevantArtifacts, activeArtifactId])

  useEffect(() => {
    if (activeArtifactId) {
      const artifact = artifacts.find(a => a.id === activeArtifactId)
      if (artifact) {
        setContent('加载中…')
        apiClient.getArtifactContent(artifact).then(data =>
          setContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
        )
      }
    }
  }, [activeArtifactId, artifacts])

  const lastStageIndex = Math.max(...requiredStages.map(k => STAGES.findIndex(s => s.key === k)).filter(i => i >= 0))
  const validRetryStages = STAGES.slice(0, Math.max(lastStageIndex, 0) + 1)
  const activeArtifact = artifacts.find(a => a.id === activeArtifactId)
  const accentColor = isIntervention ? '#B45309' : '#1D4ED8'
  const accentBg = isIntervention ? 'rgba(245,158,11,0.10)' : 'rgba(59,130,246,0.08)'
  const accentBorder = isIntervention ? 'rgba(245,158,11,0.28)' : 'rgba(59,130,246,0.20)'
  const ApproveIcon = isIntervention ? FastForward : Check

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex',
          background: 'rgba(15, 23, 42, 0.32)',
          backdropFilter: 'saturate(180%) blur(14px)',
          WebkitBackdropFilter: 'saturate(180%) blur(14px)',
        }}
      >
        {/* ─── Left: artifact viewer ─── */}
        <div style={{
          width: '60%', display: 'flex', flexDirection: 'column',
          background: 'white', borderRight: '1px solid var(--c-line)',
          boxShadow: '4px 0 24px rgba(15,23,42,0.06)',
        }}>
          {/* Tab bar */}
          <div style={{
            height: 46, flexShrink: 0,
            display: 'flex', alignItems: 'flex-end',
            padding: '0 12px', gap: 4,
            background: 'var(--c-ink-50)',
            borderBottom: '1px solid var(--c-line)',
            overflowX: 'auto',
          }}>
            {relevantArtifacts.map(a => {
              const active = activeArtifactId === a.id
              return (
                <button
                  key={a.id}
                  onClick={() => setActiveArtifactId(a.id)}
                  style={{
                    padding: '8px 14px',
                    fontSize: 12, fontFamily: 'inherit',
                    background: active ? 'white' : 'transparent',
                    color: active ? 'var(--c-ink-900)' : 'var(--c-ink-500)',
                    border: 'none',
                    borderTop: active ? `2px solid ${accentColor}` : '2px solid transparent',
                    borderRadius: '8px 8px 0 0',
                    fontWeight: active ? 500 : 400,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'white' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  {artifactLabel(a.filename)}
                </button>
              )
            })}
            {relevantArtifacts.length === 0 && (
              <span style={{ padding: '8px 14px', fontSize: 12, color: 'var(--c-ink-400)' }}>
                暂无关联产物
              </span>
            )}
          </div>

          {/* Content viewer */}
          <div style={{ flex: 1, overflow: 'auto', background: 'white' }}>
            {activeArtifact ? (
              <ArtifactContentView filename={activeArtifact.filename} content={content} variant="light" />
            ) : (
              <div style={{ padding: 28, fontSize: 13, color: 'var(--c-ink-400)' }}>
                {isIntervention
                  ? '请阅读右侧失败摘要后再决定。'
                  : '暂无可审阅的产物。'}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right: decision panel ─── */}
        <div style={{
          width: '40%', display: 'flex', flexDirection: 'column',
          padding: '28px 32px', overflowY: 'auto',
          background: 'linear-gradient(180deg, white 0%, var(--c-ink-50) 100%)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              display: 'grid', placeItems: 'center',
              background: accentBg,
              border: `1px solid ${accentBorder}`,
            }}>
              <AlertTriangle size={18} color={accentColor} strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 className="display" style={{
                fontSize: 18, fontWeight: 700, color: 'var(--c-ink-900)',
                margin: 0, letterSpacing: '-0.01em', lineHeight: 1.25,
              }}>
                {cpMeta.title}
              </h2>
              <p style={{
                fontSize: 12, color: 'var(--c-ink-500)', margin: '4px 0 0',
                lineHeight: 1.5,
              }}>
                {cpMeta.subtitle}
              </p>
              <span className="mono" style={{
                display: 'inline-block', marginTop: 8,
                padding: '2px 8px', fontSize: 10.5,
                background: 'var(--c-ink-100)', color: 'var(--c-ink-600)',
                borderRadius: 999, letterSpacing: '0.04em',
              }}>
                #{checkpoint.checkpoint_number} · {checkpoint.label}
              </span>
            </div>
          </div>

          {/* Failure context for intervention checkpoints */}
          {isIntervention && checkpoint.decision_reason && (
            <div style={{
              padding: '12px 14px', marginBottom: 20,
              background: 'rgba(245,158,11,0.06)',
              border: '1px solid rgba(245,158,11,0.20)',
              borderRadius: 10,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: '#92400E',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                marginBottom: 6,
              }}>
                失败摘要
              </div>
              <pre className="mono" style={{
                margin: 0, fontSize: 11.5, lineHeight: 1.55,
                color: 'var(--c-ink-700)', whiteSpace: 'pre-wrap',
                maxHeight: 180, overflowY: 'auto', wordBreak: 'break-word',
              }}>
                {checkpoint.decision_reason}
              </pre>
            </div>
          )}

          {/* Provider / model switcher (optional) */}
          <ModelSwitcher
            provider={nextProvider}
            model={nextModel}
            customModel={customModel}
            onProvider={setNextProvider}
            onModel={setNextModel}
            onCustomModel={setCustomModel}
            accentColor={accentColor}
          />

          {/* Approve button */}
          <button
            onClick={() => approve.mutate({
              id: checkpoint.id,
              decided_by: 'human-review',
              reason: 'Approved',
              next_provider: nextProvider,
              next_model: resolveModel(nextProvider, nextModel, customModel),
            })}
            disabled={approve.isPending}
            style={{
              width: '100%', padding: '14px 18px', marginBottom: 18,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              background: isIntervention
                ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                : 'linear-gradient(135deg, #2563EB, #1D4ED8)',
              color: 'white', border: 'none', borderRadius: 12,
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              cursor: approve.isPending ? 'wait' : 'pointer',
              opacity: approve.isPending ? 0.55 : 1,
              boxShadow: isIntervention
                ? '0 6px 20px rgba(217,119,6,0.32)'
                : '0 6px 20px rgba(29,78,216,0.28)',
              transition: 'transform 0.18s ease, box-shadow 0.18s ease',
            }}
            onMouseEnter={(e) => {
              if (approve.isPending) return
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <ApproveIcon size={16} strokeWidth={2.4} />
            {cpMeta.approveText}
          </button>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
          }}>
            <div style={{ flex: 1, height: 1, background: 'var(--c-line)' }} />
            <span style={{
              fontSize: 10, color: 'var(--c-ink-400)',
              textTransform: 'uppercase', letterSpacing: '0.12em',
            }}>
              或{isIntervention ? '让 AI 重试' : '驳回'}
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--c-line)' }} />
          </div>

          {/* Reject card */}
          <div style={{
            padding: 18, borderRadius: 14,
            background: 'white',
            border: '1px solid var(--c-line-2)',
            boxShadow: 'var(--c-shadow-sm)',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{
                fontSize: 11, fontWeight: 600, color: 'var(--c-ink-600)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {isIntervention ? '修复指引（必填）' : '驳回原因（必填）'}
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={
                  isIntervention
                    ? '描述需要 AI 重点关注的问题、约束或修复方向…'
                    : '说明哪里需要修改、AI 需要重点关注什么…'
                }
                style={{
                  width: '100%', minHeight: 90, padding: '11px 13px',
                  background: 'var(--c-ink-50)',
                  border: '1px solid var(--c-line-2)',
                  borderRadius: 10,
                  fontFamily: 'inherit', fontSize: 13,
                  color: 'var(--c-ink-900)', resize: 'vertical',
                  outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.background = 'white'
                  e.currentTarget.style.borderColor = '#3B82F6'
                  e.currentTarget.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.08)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.background = 'var(--c-ink-50)'
                  e.currentTarget.style.borderColor = 'var(--c-line-2)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{
                fontSize: 11, fontWeight: 600, color: 'var(--c-ink-600)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                <RotateCcw size={11} strokeWidth={2} />
                重试起点
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  value={retryStage}
                  onChange={e => setRetryStage(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 36px 10px 13px',
                    background: 'var(--c-ink-50)',
                    border: '1px solid var(--c-line-2)',
                    borderRadius: 10,
                    fontFamily: 'inherit', fontSize: 13,
                    color: 'var(--c-ink-900)',
                    appearance: 'none', cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {validRetryStages.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <svg
                  width={12} height={12} viewBox="0 0 24 24"
                  style={{
                    position: 'absolute', right: 13, top: '50%',
                    transform: 'translateY(-50%)', pointerEvents: 'none',
                    color: 'var(--c-ink-400)',
                  }}
                  fill="none" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            <button
              onClick={() => reject.mutate({
                id: checkpoint.id,
                decided_by: 'human-review',
                reason,
                retry_stage_key: retryStage,
                next_provider: nextProvider,
                next_model: resolveModel(nextProvider, nextModel, customModel),
              })}
              disabled={!reason.trim() || reject.isPending}
              style={{
                width: '100%', padding: '11px 14px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: reason.trim() ? '#FEF2F2' : 'var(--c-ink-100)',
                color: reason.trim() ? '#B91C1C' : 'var(--c-ink-400)',
                border: `1px solid ${reason.trim() ? '#FECACA' : 'var(--c-line-2)'}`,
                borderRadius: 10,
                fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                cursor: reason.trim() && !reject.isPending ? 'pointer' : 'not-allowed',
                opacity: reject.isPending ? 0.55 : 1,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!reason.trim() || reject.isPending) return
                e.currentTarget.style.background = '#FEE2E2'
              }}
              onMouseLeave={(e) => {
                if (!reason.trim() || reject.isPending) return
                e.currentTarget.style.background = '#FEF2F2'
              }}
            >
              <X size={13} strokeWidth={2.2} />
              {cpMeta.rejectText}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function resolveModel(provider: string, picked: string, custom: string): string {
  // Volcano / unknown providers: use the free-text input.
  if (provider === 'volcano') return custom.trim()
  // OpenAI: prefer the dropdown pick; fall back to custom text if user typed one.
  return picked || custom.trim()
}

function ModelSwitcher({
  provider, model, customModel,
  onProvider, onModel, onCustomModel,
  accentColor,
}: {
  provider: string
  model: string
  customModel: string
  onProvider: (v: string) => void
  onModel: (v: string) => void
  onCustomModel: (v: string) => void
  accentColor: string
}) {
  const showOpenAIPicker = provider === 'openai'
  const showCustomInput = provider === 'volcano' || (provider === 'openai' && !model)

  return (
    <div style={{
      padding: 14, marginBottom: 16,
      borderRadius: 12,
      background: 'var(--c-ink-50)',
      border: '1px solid var(--c-line-2)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 600, color: 'var(--c-ink-600)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        <Cpu size={11} strokeWidth={2} />
        切换 Provider / Model
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 400,
          color: 'var(--c-ink-400)', textTransform: 'none', letterSpacing: 0,
        }}>
          可选 · 仅本次决定后生效
        </span>
      </label>

      {/* Provider buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        {PROVIDER_OPTIONS.map(opt => {
          const active = provider === opt.value
          return (
            <button
              key={opt.value || 'keep'}
              type="button"
              onClick={() => onProvider(opt.value)}
              style={{
                flex: 1, padding: '7px 10px',
                fontSize: 11.5, fontFamily: 'inherit',
                background: active ? 'white' : 'transparent',
                color: active ? accentColor : 'var(--c-ink-600)',
                border: `1px solid ${active ? accentColor : 'var(--c-line-2)'}`,
                borderRadius: 8,
                cursor: 'pointer', fontWeight: active ? 600 : 500,
                transition: 'all 0.15s ease',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* OpenAI model buttons */}
      {showOpenAIPicker && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {OPENAI_MODELS.map(opt => {
            const active = model === opt.value
            return (
              <button
                key={opt.value || 'keep'}
                type="button"
                onClick={() => onModel(opt.value)}
                style={{
                  flex: '1 1 0', minWidth: 90,
                  padding: '6px 10px',
                  fontSize: 11, fontFamily: 'inherit',
                  background: active ? 'white' : 'transparent',
                  color: active ? accentColor : 'var(--c-ink-600)',
                  border: `1px solid ${active ? accentColor : 'var(--c-line-2)'}`,
                  borderRadius: 8,
                  cursor: 'pointer', fontWeight: active ? 600 : 500,
                  transition: 'all 0.15s ease',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Free-text custom model input (fallback for volcano or unrecognized) */}
      {showCustomInput && provider && (
        <input
          type="text"
          value={customModel}
          onChange={(e) => onCustomModel(e.target.value)}
          placeholder={provider === 'volcano' ? '例如 doubao-pro' : '自定义模型名（可选）'}
          style={{
            width: '100%', padding: '8px 11px',
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            background: 'white',
            border: '1px solid var(--c-line-2)',
            borderRadius: 8,
            color: 'var(--c-ink-900)', outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  )
}
