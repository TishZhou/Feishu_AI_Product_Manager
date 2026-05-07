import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Send } from 'lucide-react'
import { apiClient } from '../lib/api'

interface ClarificationModalProps {
  runId: string
  onSubmitted?: () => void
}

export function ClarificationModal({ runId, onSubmitted }: ClarificationModalProps) {
  const [answers, setAnswers] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loadingClarification, setLoadingClarification] = useState(true)
  const [clarification, setClarification] = useState<{
    title?: string
    summary?: string
    open_questions?: string[]
    missing_critical_info?: string[]
    ambiguities?: string[]
    instruction?: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    let attempts = 0

    const hasQuestions = (data: typeof clarification) =>
      !!(
        data?.open_questions?.filter(Boolean).length ||
        data?.missing_critical_info?.filter(Boolean).length ||
        data?.ambiguities?.filter(Boolean).length
      )

    const load = async () => {
      attempts += 1
      try {
        const data = await apiClient.getRunClarification(runId)
        if (cancelled) return
        setClarification(data)
        setLoadingClarification(!hasQuestions(data))
        if (hasQuestions(data) || attempts >= 20) return
      } catch {
        if (!cancelled) setClarification(null)
      }
      if (!cancelled) window.setTimeout(load, 1500)
    }

    setLoadingClarification(true)
    load()
    return () => { cancelled = true }
  }, [runId])

  const handleSubmit = async () => {
    if (!answers.trim() || submitting) return
    setSubmitting(true)
    try {
      await apiClient.clarifyRun(runId, answers.trim())
      setSubmitted(true)
      onSubmitted?.()
    } catch {
      // silently ignore — run will continue polling
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(10, 22, 40, 0.55)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: 'spring', damping: 24, stiffness: 260 }}
          style={{
            width: '100%', maxWidth: 500,
            background: 'white',
            borderRadius: 20,
            boxShadow: 'var(--c-shadow-lg)',
            border: '1px solid var(--c-line-2)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--c-line)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'rgba(245, 158, 11, 0.10)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                display: 'grid', placeItems: 'center',
              }}>
                <MessageSquare size={16} color="#B45309" strokeWidth={1.8} />
              </div>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-ink-900)', margin: 0 }}>
                  需要补充说明
                </h2>
                <p style={{ fontSize: 12, color: 'var(--c-ink-500)', margin: '2px 0 0' }}>
                  AI 在当前阶段需要更多信息才能继续
                </p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '20px 24px 24px' }}>
            {submitted ? (
              <div style={{
                textAlign: 'center', padding: '24px 0',
                color: 'var(--c-ink-500)', fontSize: 14,
              }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
                <div style={{ color: '#047857', fontWeight: 500 }}>已提交，等待 AI 继续处理…</div>
              </div>
            ) : (
              <>
                {clarification?.summary && (
                  <p style={{
                    fontSize: 13, color: 'var(--c-ink-600)',
                    lineHeight: 1.6, marginBottom: 14,
                  }}>
                    {clarification.summary}
                  </p>
                )}

                <QuestionBlock
                  title="AI 想确认的问题"
                  items={clarification?.open_questions}
                  empty={loadingClarification ? 'AI 正在整理澄清问题，页面会自动刷新…' : '暂未生成明确问题，请直接补充你认为关键的信息。'}
                />
                <QuestionBlock title="缺失的关键信息" items={clarification?.missing_critical_info} />
                <QuestionBlock title="仍存在的歧义" items={clarification?.ambiguities} />

                <textarea
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                  placeholder={clarification?.instruction || '请按上方问题逐条输入补充说明…'}
                  rows={6}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    background: 'var(--c-ink-50)',
                    border: '1px solid var(--c-line-2)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: 'var(--c-ink-900)',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.18s ease',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#3B82F6' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--c-line-2)' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button
                    onClick={handleSubmit}
                    disabled={!answers.trim() || submitting}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 20px',
                      background: answers.trim() ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'var(--c-ink-100)',
                      color: answers.trim() ? 'white' : 'var(--c-ink-400)',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: answers.trim() && !submitting ? 'pointer' : 'not-allowed',
                      transition: 'all 0.2s ease',
                      fontFamily: 'inherit',
                    }}
                  >
                    <Send size={13} strokeWidth={1.8} />
                    {submitting ? '提交中…' : '提交回复'}
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function QuestionBlock({ title, items, empty }: { title: string; items?: string[]; empty?: string }) {
  const visibleItems = (items || []).filter(Boolean)
  if (!visibleItems.length && !empty) return null

  return (
    <div style={{
      marginBottom: 14,
      padding: '12px 14px',
      background: 'rgba(245,158,11,0.06)',
      border: '1px solid rgba(245,158,11,0.18)',
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 8 }}>
        {title}
      </div>
      {visibleItems.length ? (
        <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 7 }}>
          {visibleItems.map((item, index) => (
            <li key={`${index}-${item}`} style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--c-ink-700)' }}>
              {item}
            </li>
          ))}
        </ol>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c-ink-500)' }}>{empty}</p>
      )}
    </div>
  )
}
