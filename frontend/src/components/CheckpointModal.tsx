import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, AlertTriangle, RotateCcw, FileCode2, GitPullRequestDraft, ShieldCheck } from 'lucide-react'
import type { Checkpoint, Artifact, CodeReviewFile } from '../types/api'
import { STAGES } from '../types/api'
import { useCheckpointActions, useCodeReviewFiles } from '../hooks/useDevFlow'
import { apiClient } from '../lib/api'

interface CheckpointModalProps {
  checkpoint: Checkpoint
  artifacts: Artifact[]
}

function artifactFolder(runId?: string) {
  return runId ? `artifacts/${runId}/` : 'artifacts/'
}

function DiffViewer({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="text-xs font-mono leading-5 min-h-full py-3"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
      {lines.map((line, idx) => {
        const isAdded = line.startsWith('+') && !line.startsWith('+++')
        const isDeleted = line.startsWith('-') && !line.startsWith('---')
        const isHunk = line.startsWith('@@')
        const isHeader = line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++')
        const bg = isAdded
          ? 'rgba(16,185,129,0.15)'
          : isDeleted
            ? 'rgba(239,68,68,0.15)'
            : isHunk
              ? 'rgba(51,112,255,0.14)'
              : isHeader
                ? 'rgba(255,255,255,0.045)'
                : 'transparent'
        const color = isAdded
          ? 'rgba(167,243,208,0.95)'
          : isDeleted
            ? 'rgba(254,202,202,0.95)'
            : isHunk
              ? 'rgba(191,219,254,0.95)'
              : isHeader
                ? 'rgba(226,232,240,0.80)'
                : 'rgba(203,213,225,0.82)'
        const borderColor = isAdded
          ? 'rgba(16,185,129,0.55)'
          : isDeleted
            ? 'rgba(239,68,68,0.55)'
            : 'transparent'
        return (
          <div key={idx} className="flex min-w-max"
            style={{
              background: bg,
              color,
              borderLeft: `2px solid ${borderColor}`,
            }}>
            <span className="select-none text-right shrink-0 px-3"
              style={{ width: 56, color: 'rgba(148,163,184,0.45)' }}>
              {idx + 1}
            </span>
            <span className="whitespace-pre-wrap break-words pr-4 flex-1">
              {line || ' '}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function CheckpointModal({ checkpoint, artifacts }: CheckpointModalProps) {
  const { approve, reject } = useCheckpointActions()
  const [reason, setReason] = useState('')
  const [retryStage, setRetryStage] = useState(checkpoint.retry_stage_key)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [activeReviewFile, setActiveReviewFile] = useState<string | null>(null)
  const [reviewMode, setReviewMode] = useState<'diff' | 'file'>('diff')
  const [fileDecisions, setFileDecisions] = useState<Record<string, { decision: 'pending' | 'approved' | 'rejected'; note: string }>>({})
  const [content, setContent] = useState<string>('')
  const isCodeCheckpoint = checkpoint.checkpoint_number === 2
  const { data: codeReview } = useCodeReviewFiles(checkpoint.run_id, isCodeCheckpoint)

  const requiredStages = useMemo(
    () => JSON.parse(checkpoint.required_stage_keys) as string[],
    [checkpoint.required_stage_keys]
  )
  const relevantArtifacts = useMemo(
    () => artifacts.filter(a => requiredStages.includes(a.stage_key)),
    [artifacts, requiredStages]
  )

  const selectedArtifactId = relevantArtifacts.some(a => a.id === activeArtifactId)
    ? activeArtifactId
    : relevantArtifacts[0]?.id ?? null
  const selectedArtifact = relevantArtifacts.find(a => a.id === selectedArtifactId) ?? null

  useEffect(() => {
    if (!isCodeCheckpoint && selectedArtifactId) {
      const artifact = artifacts.find(a => a.id === selectedArtifactId)
      if (artifact) {
        queueMicrotask(() => setContent(''))
        apiClient.getArtifactContent(artifact).then(data =>
          setContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
        )
      }
    }
  }, [selectedArtifactId, artifacts, isCodeCheckpoint])

  const currentStageIndex = Math.max(...requiredStages.map(k => STAGES.findIndex(s => s.key === k)).filter(i => i >= 0))
  const validRetryStages = STAGES.slice(0, currentStageIndex + 1)
  const reviewFiles = codeReview?.files ?? []
  const selectedReviewPath = reviewFiles.some(f => f.path === activeReviewFile)
    ? activeReviewFile
    : reviewFiles[0]?.path ?? null
  const selectedReviewFile = reviewFiles.find(f => f.path === selectedReviewPath) ?? null
  const patchOk = codeReview?.patch_applied_to_workspace === true
  const reviewedCount = reviewFiles.filter(f => fileDecisions[f.path]?.decision === 'approved').length
  const rejectedFiles = reviewFiles.filter(f => fileDecisions[f.path]?.decision === 'rejected')
  const pendingFiles = reviewFiles.filter(f => !fileDecisions[f.path] || fileDecisions[f.path].decision === 'pending')
  const canApproveCode = !isCodeCheckpoint || (patchOk && reviewFiles.length > 0 && rejectedFiles.length === 0 && pendingFiles.length === 0)
  const generatedRejectReason = [
    ...(!patchOk && isCodeCheckpoint ? [`Patch 应用失败：${codeReview?.workspace_apply_error || 'unknown error'}`] : []),
    ...rejectedFiles.map(f => {
      const note = fileDecisions[f.path]?.note
      return `${f.path} 被拒绝${note ? `：${note}` : ''}`
    }),
  ].join('\n')

  const setDecision = (file: CodeReviewFile, decision: 'pending' | 'approved' | 'rejected') => {
    setFileDecisions(prev => ({
      ...prev,
      [file.path]: {
        decision,
        note: prev[file.path]?.note ?? '',
      },
    }))
  }

  const setDecisionNote = (file: CodeReviewFile, note: string) => {
    setFileDecisions(prev => ({
      ...prev,
      [file.path]: {
        decision: prev[file.path]?.decision ?? 'pending',
        note,
      },
    }))
  }

  const submitReject = () => {
    const finalReason = reason.trim() || generatedRejectReason
    if (!finalReason.trim()) return
    reject.mutate({ id: checkpoint.id, decided_by: '人工审核', reason: finalReason, retry_stage_key: retryStage })
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex"
        style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(24px)' }}
      >
        <div className="absolute top-[-10%] left-[10%] w-[400px] h-[400px] rounded-full opacity-[0.08] pointer-events-none"
          style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-5%] right-[5%] w-[350px] h-[350px] rounded-full opacity-[0.06] pointer-events-none"
          style={{ background: 'radial-gradient(circle, #3370ff 0%, transparent 70%)' }} />

        {/* Left: code viewer */}
        <div className="w-3/5 flex flex-col"
          style={{
            background: '#0d1117',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}>
          {/* Tab bar */}
          <div className="h-14 shrink-0 flex items-end px-2 gap-0.5 overflow-x-auto"
            style={{ background: '#161b22', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {isCodeCheckpoint ? (
              <>
                {reviewFiles.map(file => (
                  <button
                    key={file.path}
                    onClick={() => setActiveReviewFile(file.path)}
                    className={`px-4 py-2 text-xs font-mono transition-all border-t-2 rounded-t-md whitespace-nowrap flex items-center gap-2 ${
                      selectedReviewPath === file.path
                        ? 'bg-[#0d1117] text-white border-[#3370ff]'
                        : 'bg-transparent text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    {file.path}
                  </button>
                ))}
                {reviewFiles.length === 0 && (
                  <span className="px-4 py-2 text-xs text-slate-600 font-mono">暂无代码变更</span>
                )}
              </>
            ) : (
              <>
                {relevantArtifacts.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setActiveArtifactId(a.id)}
                    className={`px-4 py-2 text-xs font-mono transition-all border-t-2 rounded-t-md whitespace-nowrap ${
                      selectedArtifactId === a.id
                        ? 'bg-[#0d1117] text-white border-[#3370ff]'
                        : 'bg-transparent text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <span className="flex flex-col items-start leading-tight">
                      <span>{a.filename}</span>
                      <span className="text-[9px] opacity-55">{artifactFolder(a.run_id)}</span>
                    </span>
                  </button>
                ))}
                {relevantArtifacts.length === 0 && (
                  <span className="px-4 py-2 text-xs text-slate-600 font-mono">暂无产物</span>
                )}
              </>
            )}
          </div>

          {/* Code viewer */}
          <div className="flex-1 overflow-auto" style={{ background: '#0d1117' }}>
            {isCodeCheckpoint ? (
              <div className="min-h-full">
                <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2"
                  style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <GitPullRequestDraft className="w-4 h-4" />
                    <span>{selectedReviewFile?.action?.toUpperCase() || 'CHANGE'}</span>
                    {selectedReviewFile && <span className="text-emerald-400">+{selectedReviewFile.additions}</span>}
                    {selectedReviewFile && <span className="text-red-400">-{selectedReviewFile.deletions}</span>}
                  </div>
                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    {(['diff', 'file'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setReviewMode(mode)}
                        className={`px-3 py-1.5 text-xs ${reviewMode === mode ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {mode === 'diff' ? 'Diff' : '完整文件'}
                      </button>
                    ))}
                  </div>
                </div>
                {selectedReviewFile
                  ? reviewMode === 'diff'
                    ? <DiffViewer text={selectedReviewFile.diff} />
                    : (
                      <pre
                        className="text-xs font-mono text-slate-300 p-4 m-0 whitespace-pre-wrap break-words leading-5 min-h-full"
                        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                      >
                        {selectedReviewFile.generated_content || '没有生成后的完整文件快照'}
                      </pre>
                    )
                  : (
                    <pre className="text-xs font-mono text-slate-300 p-4 m-0">加载中...</pre>
                  )}
              </div>
            ) : (
              <div className="min-h-full">
                {selectedArtifact && (
                  <div className="sticky top-0 z-10 px-4 py-2 text-[11px] font-mono"
                    style={{
                      background: '#0d1117',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      color: 'rgba(148,163,184,0.75)',
                    }}>
                    artifact folder: <span className="text-slate-200">{artifactFolder(selectedArtifact.run_id)}</span>
                  </div>
                )}
                {selectedArtifact?.filename.endsWith('.patch') ? (
                  <DiffViewer text={content || '加载中...'} />
                ) : (
                  <pre
                    className="text-xs font-mono text-slate-300 p-4 m-0 whitespace-pre-wrap break-words leading-5 min-h-full"
                    style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                  >
                    {content || '加载中...'}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: decision panel */}
        <div className="w-2/5 flex flex-col p-7 overflow-y-auto"
          style={{
            background: 'linear-gradient(180deg, rgba(10,15,28,0.98) 0%, rgba(3,7,18,0.98) 100%)',
          }}>
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
              <h2 className="text-lg font-bold text-white leading-tight">
                {isCodeCheckpoint ? '代码审核' : '方案审核'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                检查点 #{checkpoint.checkpoint_number} · {checkpoint.label}
              </p>
              <p className="text-[11px] text-slate-600 mt-1">
                {isCodeCheckpoint ? '逐文件审查 diff 和生成后的代码，再决定是否继续' : '请仔细审查左侧产物后作出决策'}
              </p>
            </div>
          </div>

          {isCodeCheckpoint && (
            <div className="rounded-2xl p-4 mb-5 space-y-3"
              style={{
                background: 'rgba(255,255,255,0.035)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">代码变更</span>
                <span className="text-xs text-slate-500">{reviewedCount}/{reviewFiles.length} approved</span>
              </div>
              <div className="rounded-xl px-3 py-2 space-y-1"
                style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center justify-between gap-3 text-[10px] font-mono">
                  <span className="text-slate-500">artifact folder</span>
                  <span className="text-slate-300 truncate" title={artifactFolder(checkpoint.run_id)}>
                    {artifactFolder(checkpoint.run_id)}
                  </span>
                </div>
                {Object.entries(codeReview?.source_artifacts ?? {}).map(([name, id]) => (
                  <div key={name} className="flex items-center justify-between gap-3 text-[10px] font-mono">
                    <span className="text-slate-500 truncate">{name}</span>
                    <span className="text-slate-300 truncate" title={id}>db id:{id || 'none'}</span>
                  </div>
                ))}
              </div>
              {patchOk ? (
                <div className="flex items-start gap-2 text-xs text-emerald-300">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Patch 已成功应用到隔离 workspace。</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-xs text-red-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{codeReview?.workspace_apply_error || 'Patch 未成功应用，不能批准。'}</span>
                </div>
              )}
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {reviewFiles.map(file => {
                  const decision = fileDecisions[file.path]?.decision ?? 'pending'
                  return (
                    <div key={file.path} className="rounded-xl p-3"
                      style={{
                        background: selectedReviewPath === file.path ? 'rgba(51,112,255,0.11)' : 'rgba(0,0,0,0.22)',
                        border: `1px solid ${
                          decision === 'approved'
                            ? 'rgba(16,185,129,0.35)'
                            : decision === 'rejected'
                              ? 'rgba(239,68,68,0.35)'
                              : 'rgba(255,255,255,0.07)'
                        }`,
                      }}>
                      <button
                        type="button"
                        onClick={() => setActiveReviewFile(file.path)}
                        className="w-full text-left text-xs font-mono text-slate-200 hover:text-white truncate"
                      >
                        {file.path}
                      </button>
                      <div className="flex gap-1.5 mt-2">
                        {(['approved', 'rejected', 'pending'] as const).map(choice => (
                          <button
                            key={choice}
                            type="button"
                            onClick={() => setDecision(file, choice)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] transition ${
                              decision === choice
                                ? 'bg-white/14 text-white'
                                : 'bg-white/5 text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {choice === 'approved' ? 'Approve' : choice === 'rejected' ? 'Reject' : 'Pending'}
                          </button>
                        ))}
                      </div>
                      {decision === 'rejected' && (
                        <textarea
                          value={fileDecisions[file.path]?.note ?? ''}
                          onChange={e => setDecisionNote(file, e.target.value)}
                          placeholder="这个文件需要怎么改？"
                          className="mt-2 w-full h-16 rounded-lg px-2.5 py-2 text-xs text-white placeholder-slate-700 resize-none"
                          style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.07)',
                            outline: 'none',
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <button
            onClick={() => approve.mutate({ id: checkpoint.id, decided_by: '人工审核', reason: '方案通过' })}
            disabled={approve.isPending || !canApproveCode}
            className="btn-approve w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2.5 disabled:opacity-50 mb-5"
          >
            <Check className="w-5 h-5" strokeWidth={2.5} />
            批准并继续
          </button>
          {isCodeCheckpoint && !canApproveCode && (
            <p className="text-[11px] text-slate-500 -mt-3 mb-5">
              需要所有文件都 Approve，并且 patch 成功应用到隔离 workspace，才可以继续。
            </p>
          )}

          <div className="relative flex items-center gap-3 mb-5">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-[10px] text-slate-600 uppercase tracking-widest shrink-0">或拒绝</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

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
              onClick={submitReject}
              disabled={!(reason.trim() || generatedRejectReason) || reject.isPending}
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
