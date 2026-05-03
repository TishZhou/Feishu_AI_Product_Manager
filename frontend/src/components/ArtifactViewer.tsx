import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FileCode2 } from 'lucide-react'
import type { Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { apiClient } from '../lib/api'

interface ArtifactViewerProps {
  artifact: Artifact | null
  onClose: () => void
}

export function ArtifactViewer({ artifact, onClose }: ArtifactViewerProps) {
  const [content, setContent] = useState('')

  useEffect(() => {
    if (artifact) {
      setContent('加载中...')
      apiClient.getArtifactContent(artifact).then(data =>
        setContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
      )
    }
  }, [artifact])

  return (
    <AnimatePresence>
      {artifact && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(3,7,18,0.6)', backdropFilter: 'blur(8px)' }}
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed inset-y-0 right-0 z-50 w-[820px] max-w-[92vw] flex flex-col"
            style={{
              background: '#0d1117',
              borderLeft: '1px solid rgba(255,255,255,0.07)',
              boxShadow: '-20px 0 80px rgba(0,0,0,0.6), -1px 0 0 rgba(51,112,255,0.1)',
            }}
          >
            {/* Header */}
            <div className="h-14 shrink-0 flex items-center justify-between px-5"
              style={{
                background: '#161b22',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-1.5 rounded-lg shrink-0"
                  style={{ background: 'rgba(51,112,255,0.12)', border: '1px solid rgba(51,112,255,0.2)' }}>
                  <FileCode2 className="w-4 h-4 text-[#3370ff]" />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-mono text-sm truncate">{artifact.filename}</p>
                  <p className="text-slate-500 text-[11px] font-mono">
                    {(artifact.size_bytes / 1024).toFixed(1)} KB · {STAGES.find(s => s.key === artifact.stage_key)?.label ?? artifact.stage_key}
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="btn-close p-2 rounded-lg text-slate-500 shrink-0 ml-4"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Code viewer */}
            <div className="flex-1 overflow-auto" style={{ background: '#0d1117' }}>
              <pre
                className="text-xs font-mono text-slate-300 p-5 m-0 whitespace-pre-wrap break-words leading-5 min-h-full"
                style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
              >
                {content}
              </pre>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
