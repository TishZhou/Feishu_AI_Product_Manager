import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Editor } from '@monaco-editor/react'
import { Check, X, AlertCircle } from 'lucide-react'
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

  // Filter artifacts belonging to the stage just before this checkpoint
  const requiredStages = JSON.parse(checkpoint.required_stage_keys) as string[]
  const relevantArtifacts = artifacts.filter(a => requiredStages.includes(a.stage_key))

  useEffect(() => {
    if (relevantArtifacts.length > 0 && !activeArtifactId) {
      setActiveArtifactId(relevantArtifacts[0].id)
    }
  }, [relevantArtifacts, activeArtifactId])

  useEffect(() => {
    if (activeArtifactId) {
      const artifact = artifacts.find(a => a.id === activeArtifactId)
      if (artifact) {
        apiClient.getArtifactContent(artifact).then(setContent)
      }
    }
  }, [activeArtifactId, artifacts])

  // Get index of current checkpoint to determine valid retry stages
  const currentStageIndex = STAGES.findIndex(s => requiredStages.includes(s.key))
  const validRetryStages = STAGES.slice(0, currentStageIndex + 1)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex bg-slate-950/80 backdrop-blur-xl"
      >
        <div className="w-3/5 border-r border-white/10 flex flex-col bg-[#1e1e1e]">
          <div className="h-12 bg-[#2d2d2d] flex items-center px-2 gap-1 overflow-x-auto">
            {relevantArtifacts.map(a => (
              <button
                key={a.id}
                onClick={() => setActiveArtifactId(a.id)}
                className={`px-4 py-2 text-sm font-mono transition-colors border-t-2 ${
                  activeArtifactId === a.id 
                    ? 'bg-[#1e1e1e] text-white border-[#3370ff]' 
                    : 'bg-transparent text-slate-400 border-transparent hover:bg-white/5'
                }`}
              >
                {a.filename}
              </button>
            ))}
          </div>
          <div className="flex-1">
            <Editor
              height="100%"
              theme="vs-dark"
              language={relevantArtifacts.find(a => a.id === activeArtifactId)?.filename.endsWith('.json') ? 'json' : 'markdown'}
              value={content}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
            />
          </div>
        </div>

        <div className="w-2/5 flex flex-col p-8 bg-slate-900 border-l border-white/10 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <AlertCircle className="w-8 h-8 text-[#f59e0b]" />
            <div>
              <h2 className="text-xl font-bold text-white">Approval Required</h2>
              <p className="text-sm text-slate-400">Checkpoint #{checkpoint.checkpoint_number}: {checkpoint.label}</p>
            </div>
          </div>

          <div className="space-y-6 flex-1">
            <button
              onClick={() => approve.mutate({ id: checkpoint.id, decided_by: 'human', reason: 'Looks good' })}
              disabled={approve.isPending}
              className="w-full py-4 bg-[#00b42a] hover:bg-[#009923] text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Check className="w-5 h-5" /> Approve & Continue
            </button>

            <div className="h-px bg-white/10 relative">
              <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-2 text-xs text-slate-500 uppercase tracking-widest">OR REJECT</span>
            </div>

            <div className="space-y-4 bg-black/20 p-5 rounded-xl border border-white/5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Rejection Reason</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Explain what needs to be fixed..."
                  className="w-full h-24 bg-black/40 border border-white/10 rounded-lg p-3 text-white placeholder-slate-600 focus:outline-none focus:border-red-500 transition-colors text-sm resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Retry From Stage</label>
                <select
                  value={retryStage}
                  onChange={e => setRetryStage(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-red-500 transition-colors text-sm appearance-none"
                >
                  {validRetryStages.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => reject.mutate({ id: checkpoint.id, decided_by: 'human', reason, retry_stage_key: retryStage })}
                disabled={!reason || reject.isPending}
                className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" /> Reject & Retry
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
