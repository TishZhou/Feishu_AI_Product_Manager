import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Editor } from '@monaco-editor/react'
import { Check, X, AlertTriangle, RotateCcw } from 'lucide-react'
import type { Checkpoint, Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { useCheckpointActions } from '../hooks/useDevFlow'
import { apiClient } from '../lib/api'

interface CheckpointModalProps {
  checkpoint: Checkpoint
  artifacts: Artifact[]
}

export function CheckpointModal({ checkpoint, artifacts }: CheckpointModalProps) {
  const { approve, reject } = useCheckpointActions()
  const [reason, setReason] = useState('')
  const [retryStage, setRetryStage] = useState(checkpoint.retry_stage_key)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')

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
        setContent('加载中...')
        apiClient.getArtifactContent(artifact).then(setContent)
      }
    }
  }, [activeArtifactId, artifacts])

  const currentStageIndex = STAGES.findIndex(s => requiredStages.includes(s.key))
  const validRetryStages = STAGES.slice(0, currentStageIndex + 1)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex"
        style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(24px)' }}
      >
        {/* Ambient blobs in modal */}
        <div className="absolute top-[-10%] left-[10%] w-[400px] h-[400px] rounded-full opacity-[0.08] pointer-events-none"
          style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-5%] right-[5%] w-[350px] h-[350px] rounded-full opacity-[0.06] pointer-events-none"
          style={{ background: 'radial-gradient(circle, #3370ff 0%, transparent 70%)' }} />

        {/* Left: code editor */}
        <div className="w-3/5 flex flex-col"
          style={{
            background: '#0d1117',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}>
          {/* Tab bar */}
          <div className="h-11 shrink-0 flex items-end px-2 gap-0.5 overflow-x-auto"
            style={{ background: '#161b22', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {relevantArtifacts.map(a => (
              <button
                key={a.id}
                onClick={() => setActiveArtifactId(a.id)}
                className={`px-4 py-2 text-xs font-mono transition-all border-t-2 rounded-t-md whitespace-nowrap ${
                  activeArtifactId === a.id
                    ? 'bg-[#0d1117] text-white border-[#3370ff]'
                    : 'bg-transparent text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                {a.filename}
              </button>
            ))}
            {relevantArtifacts.length === 0 && (
              <span className="px-4 py-2 text-xs text-slate-600 font-mono">暂无产物</span>
            )}
          </div>

          {/* Monaco */}
          <div className="flex-1">
            <Editor
              height="100%"
              theme="vs-dark"
              language={
                relevantArtifacts.find(a => a.id === activeArtifactId)?.filename.endsWith('.json')
                  ? 'json'
                  : 'markdown'
              }
              value={content}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineHeight: 20,
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                renderLineHighlight: 'none',
              }}
            />
          </div>
        </div>

        {/* Right: decision panel */}
        <div className="w-2/5 flex flex-col p-7 overflow-y-auto"
          style={{
            background: 'linear-gradient(180deg, rgba(10,15,28,0.98) 0%, rgba(3,7,18,0.98) 100%)',
          }}>
          {/* Title */}
          <div className="flex items-start gap-3 mb-7">
            <div className="p-2.5 rounded-xl shrink-0 mt-0.5"
              style={{
                background: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.3)',
                boxShadow: '0 0 16px rgba(245,158,11,0.15)',
              }}>
              <AlertTriangle className="w-5 h-5 text-[#f59e0b]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">方案审核</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                检查点 #{checkpoint.checkpoint_number} · {checkpoint.label}
              </p>
              <p className="text-[11px] text-slate-600 mt-1">请仔细审查左侧产物后作出决策</p>
            </div>
          </div>

          {/* Approve button */}
          <button
            onClick={() => approve.mutate({ id: checkpoint.id, decided_by: '人工审核', reason: '方案通过' })}
            disabled={approve.isPending}
            className="btn-approve w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2.5 disabled:opacity-50 mb-5"
          >
            <Check className="w-5 h-5" strokeWidth={2.5} />
            批准并继续
          </button>

          {/* Divider */}
          <div className="relative flex items-center gap-3 mb-5">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-[10px] text-slate-600 uppercase tracking-widest shrink-0">或拒绝</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

          {/* Reject section */}
          <div className="rounded-2xl p-5 space-y-4"
            style={{
              background: 'rgba(239,68,68,0.04)',
              border: '1px solid rgba(239,68,68,0.12)',
            }}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">拒绝原因</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="说明需要修改的内容..."
                className="w-full h-24 rounded-xl px-3.5 py-3 text-sm text-white placeholder-slate-700 resize-none transition-all"
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  outline: 'none',
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.08)'
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <RotateCcw className="w-3 h-3" />
                回退节点
              </label>
              <div className="relative">
                <select
                  value={retryStage}
                  onChange={e => setRetryStage(e.target.value)}
                  className="w-full rounded-xl px-3.5 py-3 text-sm text-white appearance-none cursor-pointer"
                  style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    outline: 'none',
                  }}
                >
                  {validRetryStages.map(s => (
                    <option key={s.key} value={s.key} style={{ background: '#1e293b' }}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            <button
              onClick={() => reject.mutate({ id: checkpoint.id, decided_by: '人工审核', reason, retry_stage_key: retryStage })}
              disabled={!reason || reject.isPending}
              className="btn-reject w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
              拒绝并重试
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
