import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Send } from 'lucide-react'
import { useClarification, useSubmitClarification } from '../hooks/useDevFlow'

interface ClarificationModalProps {
  runId: string
}

function normalizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') return JSON.stringify(item)
      return String(item ?? '')
    })
    .map(item => item.trim())
    .filter(Boolean)
}

export function ClarificationModal({ runId }: ClarificationModalProps) {
  const submitClarification = useSubmitClarification()
  const { data: payload, isLoading, isError } = useClarification(runId)
  const [answers, setAnswers] = useState('')

  const questionGroups = [
    { title: '待确认问题', items: normalizeItems(payload?.open_questions) },
    { title: '缺失的关键信息', items: normalizeItems(payload?.missing_critical_info) },
    { title: '当前歧义', items: normalizeItems(payload?.ambiguities) },
  ]
  const hasClarificationDetails = questionGroups.some(group => group.items.length > 0)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
        style={{ background: 'rgba(3,7,18,0.82)', backdropFilter: 'blur(24px)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="w-full max-w-2xl rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(3,7,18,0.98) 100%)',
            border: '1px solid rgba(251,191,36,0.28)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          }}
        >
          <div className="p-6 border-b border-white/10">
            <div className="flex items-start gap-3">
              <div
                className="p-2.5 rounded-xl shrink-0"
                style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.28)' }}
              >
                <AlertCircle className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{payload?.title || '需求澄清'}</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {payload?.instruction || 'Stage 1 发现部分需求会影响后续架构或验收判断，请补充说明后重新分析。'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {payload?.summary && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">当前理解</p>
                <p className="text-sm text-slate-200 leading-relaxed">{payload.summary}</p>
                {payload?.confidence_score !== undefined && payload?.confidence_score !== null && (
                  <p className="text-[11px] text-amber-300/80 mt-3">
                    置信度：{String(payload.confidence_score)}
                  </p>
                )}
              </div>
            )}

            {isLoading && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)' }}>
                <p className="text-sm text-amber-200 leading-relaxed">
                  正在读取需求澄清内容...
                </p>
              </div>
            )}

            {isError && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                <p className="text-sm text-red-200 leading-relaxed">
                  无法读取需求澄清内容，请确认后端服务仍在运行。
                </p>
              </div>
            )}

            {questionGroups.map(group => group.items.length > 0 && (
              <div key={group.title}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">{group.title}</p>
                <ul className="space-y-2">
                  {group.items.map((item, index) => (
                    <li key={`${group.title}-${index}`} className="text-sm text-slate-200 leading-relaxed rounded-lg px-3 py-2 bg-white/[0.035]">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {!isLoading && !isError && !hasClarificationDetails && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)' }}>
                <p className="text-sm text-amber-100 leading-relaxed">
                  后端还没有返回结构化澄清问题。你仍可以直接补充需求范围、优先级、边界条件和验收标准。
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">你的补充说明</label>
              <textarea
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
                placeholder="逐条回答上面的问题。也可以补充范围、优先级、边界条件、验收标准等信息。"
                className="w-full h-36 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 resize-none"
                style={{
                  background: 'rgba(0,0,0,0.28)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="button"
              disabled={!answers.trim() || submitClarification.isPending}
              onClick={() => submitClarification.mutate({ runId, answers: answers.trim() })}
              className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg,#f59e0b,#2563eb)',
                boxShadow: '0 14px 36px rgba(37,99,235,0.28)',
              }}
            >
              <Send className="w-4 h-4" />
              {submitClarification.isPending ? '正在提交...' : '提交澄清并重新分析'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
