import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FileCode2 } from 'lucide-react'
import type { Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { apiClient } from '../lib/api'
import { artifactLabel } from '../lib/artifactLabels'
import { ArtifactContentView } from './ArtifactContentView'

interface ArtifactViewerProps {
  artifact: Artifact | null
  onClose: () => void
}

export function ArtifactViewer({ artifact, onClose }: ArtifactViewerProps) {
  const [content, setContent] = useState('')

  useEffect(() => {
    if (artifact) {
      setContent('加载中…')
      apiClient.getArtifactContent(artifact).then(data =>
        setContent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
      )
    }
  }, [artifact])

  // ESC closes
  useEffect(() => {
    if (!artifact) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [artifact, onClose])

  return (
    <AnimatePresence>
      {artifact && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 40,
              background: 'rgba(15,23,42,0.32)',
              backdropFilter: 'saturate(180%) blur(14px)',
              WebkitBackdropFilter: 'saturate(180%) blur(14px)',
            }}
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            style={{
              position: 'fixed', insetBlock: 0, right: 0, zIndex: 50,
              width: 880, maxWidth: '92vw',
              display: 'flex', flexDirection: 'column',
              background: 'white',
              borderLeft: '1px solid var(--c-line)',
              boxShadow: '-24px 0 60px rgba(15,23,42,0.10)',
            }}
          >
            {/* Header */}
            <div style={{
              height: 60, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 20px',
              background: 'rgba(252,253,254,0.85)',
              backdropFilter: 'saturate(180%) blur(12px)',
              WebkitBackdropFilter: 'saturate(180%) blur(12px)',
              borderBottom: '1px solid var(--c-line)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{
                  width: 32, height: 32, flexShrink: 0,
                  display: 'grid', placeItems: 'center',
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.18)',
                  borderRadius: 9,
                }}>
                  <FileCode2 size={15} strokeWidth={1.8} color="#1D4ED8" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="display" style={{
                    margin: 0, fontSize: 14, fontWeight: 600,
                    color: 'var(--c-ink-900)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    letterSpacing: '-0.01em',
                  }}>
                    {artifactLabel(artifact.filename)}
                  </p>
                  <p className="mono" style={{
                    margin: '2px 0 0', fontSize: 11, color: 'var(--c-ink-500)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {artifact.filename} · {(artifact.size_bytes / 1024).toFixed(1)} KB · {STAGES.find(s => s.key === artifact.stage_key)?.label ?? artifact.stage_key}
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                style={{
                  width: 32, height: 32, flexShrink: 0,
                  display: 'grid', placeItems: 'center',
                  background: 'transparent', border: '1px solid transparent',
                  borderRadius: 8, cursor: 'pointer',
                  color: 'var(--c-ink-500)',
                  transition: 'all 0.18s ease',
                  marginLeft: 16, fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--c-ink-50)'
                  e.currentTarget.style.borderColor = 'var(--c-line-2)'
                  e.currentTarget.style.color = 'var(--c-ink-900)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.borderColor = 'transparent'
                  e.currentTarget.style.color = 'var(--c-ink-500)'
                }}
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </div>

            {/* Content viewer */}
            <div style={{
              flex: 1, overflow: 'auto',
              background: 'var(--c-bg)',
            }}>
              <ArtifactContentView filename={artifact.filename} content={content} variant="light" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
