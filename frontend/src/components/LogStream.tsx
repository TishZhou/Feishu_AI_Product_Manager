import { useEffect, useRef, useState, useCallback } from 'react'
import type { StageResult, RunStatus } from '../types/api'
import { STAGES } from '../types/api'
import { getPersona, HUE_TOKENS } from '../data/personas'

interface LogStreamProps {
  stages: StageResult[]
  runStatus: RunStatus
  runId: string | null
}

interface LogEntry {
  id: string
  time: string
  stageKey: string
  stage: string
  message: string
  type: 'start' | 'success' | 'fail' | 'reject' | 'llm' | 'tool' | 'info'
  streaming?: boolean
}

const TYPE_CONFIG: Record<LogEntry['type'], { text: string; bar: string; prefix: string; rowBg: string }> = {
  start:   { text: '#1D4ED8', bar: '#3B82F6', prefix: '▶', rowBg: 'rgba(59,130,246,0.04)'  },
  success: { text: '#047857', bar: '#10B981', prefix: '✓', rowBg: 'rgba(16,185,129,0.04)'  },
  fail:    { text: '#B91C1C', bar: '#EF4444', prefix: '✗', rowBg: 'rgba(239,68,68,0.05)'   },
  reject:  { text: '#B45309', bar: '#F59E0B', prefix: '↩', rowBg: 'rgba(245,158,11,0.04)'  },
  llm:     { text: '#5B21B6', bar: '#8B5CF6', prefix: '⚡', rowBg: 'rgba(139,92,246,0.04)' },
  tool:    { text: '#0369A1', bar: '#0EA5E9', prefix: '⚙', rowBg: 'rgba(14,165,233,0.04)'  },
  info:    { text: '#475569', bar: '#94A3B8', prefix: '·', rowBg: 'transparent'            },
}

function getStageName(k: string) {
  return STAGES.find(s => s.key === k)?.label || k || '系统'
}

function nowStr() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function LogStream({ stages, runStatus, runId }: LogStreamProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const callIdMap = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  const handleEvent = useCallback((data: Record<string, unknown>) => {
    const stageKey = (data.stage_key as string) || ''
    const level    = (data.level as string) || 'info'
    const message  = (data.message as string) || ''
    const callId   = data.call_id as string | undefined
    const time     = (data.time as string) || nowStr()

    if (level === 'token' && callId) {
      setLogs(prev => {
        const existingId = callIdMap.current.get(callId)
        if (existingId) {
          return prev.map(e => e.id === existingId ? { ...e, message: e.message + message, streaming: true } : e)
        }
        const newId = `${callId}-${Date.now()}`
        callIdMap.current.set(callId, newId)
        return [...prev, { id: newId, time, stageKey, stage: getStageName(stageKey), message, type: 'llm', streaming: true }]
      })
      return
    }

    if (level === 'llm' && callId) {
      setLogs(prev => {
        const existingId = callIdMap.current.get(callId)
        if (existingId) {
          if (message.includes('推理完成') || message.includes('汇总完成')) {
            callIdMap.current.delete(callId)
            return prev.map(e => e.id === existingId ? { ...e, streaming: false } : e)
          }
          return prev
        }
        const newId = `llm-meta-${callId}-${Date.now()}`
        return [...prev, { id: newId, time, stageKey, stage: getStageName(stageKey), message, type: 'llm', streaming: false }]
      })
      return
    }

    const validType = (['start', 'success', 'fail', 'reject', 'llm', 'tool', 'info'].includes(level)
      ? level : 'info') as LogEntry['type']
    setLogs(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      time, stageKey, stage: getStageName(stageKey),
      message, type: validType, streaming: false,
    }])
  }, [])

  useEffect(() => {
    if (!runId) {
      queueMicrotask(() => { setLogs([]); setConnected(false) })
      return
    }
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    queueMicrotask(() => setLogs([]))
    callIdMap.current.clear()
    const es = new EventSource(`/api/runs/${runId}/logs/stream`)
    esRef.current = es
    es.onopen    = () => setConnected(true)
    es.onmessage = (ev) => { try { handleEvent(JSON.parse(ev.data)) } catch { /* ignore */ } }
    es.onerror   = () => { setConnected(false); es.close() }
    return () => { es.close(); esRef.current = null; setConnected(false) }
  }, [runId, handleEvent])

  const activeStage = runStatus === 'running' ? stages.find(s => s.status === 'running') : undefined
  const activePersona = activeStage ? getPersona(activeStage.stage_key) : null
  const activeHue = activePersona ? HUE_TOKENS[activePersona.hue] : null

  return (
    <div className="mono" style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontSize: 11.5,
      background: 'white',
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        borderBottom: '1px solid var(--c-line)',
        background: 'var(--c-ink-50)',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'Inter',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--c-ink-500)',
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
        }}>
          AI 思考日志
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {runId && (
            <div style={{
              fontFamily: 'Inter',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10.5,
              fontWeight: 500,
              color: connected ? '#047857' : 'var(--c-ink-400)',
            }}>
              <span
                style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#10B981' : 'var(--c-ink-300)' }}
                className={connected ? 'animate-breathe' : ''}
              />
              {connected ? '实时同步' : '等待中'}
            </div>
          )}
          {activeStage && activeHue && activePersona && (
            <div style={{
              fontFamily: 'Inter',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10.5,
              fontWeight: 500,
              color: activeHue.solidDark,
            }}>
              <span
                style={{ width: 6, height: 6, borderRadius: '50%', background: activeHue.solid }}
                className="animate-breathe"
              />
              {activePersona.name} 推理中
            </div>
          )}
        </div>
      </div>

      {/* Stream */}
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto' }}>
        {logs.length === 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--c-ink-400)',
            fontSize: 11.5,
            fontFamily: 'Inter',
          }}>
            {runId ? '正在连接日志流…' : '等待流水线启动'}
          </div>
        )}

        {logs.map(log => {
          const c = TYPE_CONFIG[log.type]
          return (
            <div
              key={log.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                minHeight: 22,
                borderLeft: `2px solid ${c.bar}33`,
                background: c.rowBg,
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(15, 23, 42, 0.02)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = c.rowBg }}
            >
              <span style={{
                flexShrink: 0, color: 'var(--c-ink-400)',
                padding: '3px 10px', width: 80,
                fontFeatureSettings: '"tnum"', fontSize: 11,
              }}>{log.time}</span>

              <span style={{
                flexShrink: 0, width: 20, padding: '3px 0',
                textAlign: 'center', color: c.text, fontWeight: 500,
              }}>{c.prefix}</span>

              <span style={{
                flexShrink: 0, fontSize: 9.5, fontWeight: 600,
                padding: '1px 6px', borderRadius: 4,
                margin: '4px 6px 0 4px',
                background: `${c.bar}18`, color: c.text,
                border: `1px solid ${c.bar}30`,
                letterSpacing: '0.02em',
              }}>{log.stage.slice(0, 4)}</span>

              <span style={{
                color: 'var(--c-ink-800)',
                padding: '3px 16px 3px 4px',
                lineHeight: 1.6,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                flex: 1,
              }}>
                {log.message}
                {log.streaming && (
                  <span
                    style={{ display: 'inline-block', width: 6, height: 12, marginLeft: 2, verticalAlign: -1, background: '#8B5CF6', opacity: 0.85 }}
                    className="animate-blink"
                  />
                )}
              </span>
            </div>
          )
        })}

        {/* Active cursor */}
        {activeStage && activeHue && activePersona && (
          <div style={{
            display: 'flex', alignItems: 'center', minHeight: 22,
            borderLeft: `2px solid ${activeHue.solid}`,
            background: `rgba(${activeHue.pulseRGB}, 0.04)`,
          }}>
            <span style={{ flexShrink: 0, color: 'var(--c-ink-400)', padding: '3px 10px', width: 80, fontFeatureSettings: '"tnum"', fontSize: 11 }}>{nowStr()}</span>
            <span style={{ flexShrink: 0, width: 20, padding: '3px 0', textAlign: 'center', color: activeHue.solid, fontWeight: 500 }}>▶</span>
            <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 4, margin: '4px 6px 0 4px', background: activeHue.softBg, color: activeHue.solidDark, border: `1px solid ${activeHue.softBorder}` }}>{activePersona.name}</span>
            <span style={{ color: activeHue.solidDark, padding: '3px 0' }}>{activePersona.statusVerb}</span>
            <span style={{ display: 'inline-block', width: 6, height: 12, marginLeft: 6, verticalAlign: -1, background: activeHue.solid, opacity: 0.85 }} className="animate-blink" />
          </div>
        )}
      </div>
    </div>
  )
}
