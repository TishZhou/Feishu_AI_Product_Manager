import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Editor } from '@monaco-editor/react'
import { X } from 'lucide-react'
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
      setContent('Loading...')
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
    return 'plaintext'
  }

  return (
    <AnimatePresence>
      {artifact && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 z-50 w-[800px] max-w-[90vw] bg-[#1e1e1e] border-l border-white/10 shadow-2xl flex flex-col"
          >
            <div className="h-14 shrink-0 border-b border-white/10 flex items-center justify-between px-6 bg-[#2d2d2d]">
              <div>
                <h3 className="text-white font-mono text-sm">{artifact.filename}</h3>
                <p className="text-slate-400 text-xs font-mono">{(artifact.size_bytes / 1024).toFixed(1)} KB • {artifact.stage_key}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1">
              <Editor
                height="100%"
                theme="vs-dark"
                language={getLanguage(artifact.filename)}
                value={content}
                options={{
                  readOnly: true,
                  minimap: { enabled: true },
                  fontSize: 14,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
