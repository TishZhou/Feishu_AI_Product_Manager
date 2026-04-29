import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Editor } from '@monaco-editor/react'
import { X, FileCode2 } from 'lucide-react'
import type { Artifact } from '../types/api'
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
      apiClient.getArtifactContent(artifact).then(setContent)
    }
  }, [artifact])

  const getLanguage = (filename: string) => {
    if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript'
    if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript'
    if (filename.endsWith('.json')) return 'json'
    if (filename.endsWith('.py')) return 'python'
    if (filename.endsWith('.md')) return 'markdown'
    if (filename.endsWith('.css')) return 'css'
    if (filename.endsWith('.html')) return 'html'
    if (filename.endsWith('.patch') || filename.endsWith('.diff')) return 'diff'
    return 'plaintext'
  }

  return (
    <AnimatePresence>
      {artifact && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(3,7,18,0.6)', backdropFilter: 'blur(8px)' }}
          />

          {/* Panel */}
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
                    {(artifact.size_bytes / 1024).toFixed(1)} KB · {artifact.stage_key}
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="p-2 rounded-lg text-slate-500 hover:text-white transition-all shrink-0 ml-4"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Monaco Editor */}
            <div className="flex-1">
              <Editor
                height="100%"
                theme="vs-dark"
                language={getLanguage(artifact.filename)}
                value={content}
                options={{
                  readOnly: true,
                  minimap: { enabled: true },
                  fontSize: 13,
                  lineHeight: 20,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  padding: { top: 16 },
                  renderLineHighlight: 'gutter',
                }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
