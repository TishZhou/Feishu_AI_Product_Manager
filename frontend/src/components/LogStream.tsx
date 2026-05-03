import { useEffect, useRef, useState, useCallback } from 'react'
import type { StageResult, RunStatus } from '../types/api'
import { STAGES } from '../types/api'

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
  start:   { text: '#93c5fd', bar: '#3b82f6', prefix: '▶', rowBg: 'rgba(59,130,246,0.04)' },
  success: { text: '#6ee7b7', bar: '#10b981', prefix: '✓', rowBg: 'rgba(16,185,129,0.04)' },
  fail:    { text: '#fca5a5', bar: '#ef4444', prefix: '✗', rowBg: 'rgba(239,68,68,0.05)'  },
  reject:  { text: '#fcd34d', bar: '#f59e0b', prefix: '↩', rowBg: 'rgba(245,158,11,0.04)' },
  llm:     { text: '#c4b5fd', bar: '#8b5cf6', prefix: '⚡', rowBg: 'rgba(139,92,246,0.04)' },
  tool:    { text: '#7dd3fc', bar: '#0ea5e9', prefix: '⚙', rowBg: 'rgba(14,165,233,0.04)'  },
  info:    { text: '#64748b', bar: '#1e293b', prefix: '·', rowBg: 'transparent'            },
}

const STAGE_BADGE: Record<string, string> = {
  requirement_analysis:  '需求',
  solution_architecture: '架构',
  detailed_spec:         '规格',
  code_generation:       '生成',
  test_generation:       '测试',
  code_review:           '审查',
  delivery:              '交付',
}

function getStageName(k: string) {
  return STAGES.find(s => s.key === k)?.label || k || '系统'
}

function nowStr() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function LogStream({ stages, runStatus: _runStatus, runId }: LogStreamProps) {
  const [logs, setLogs]           = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const containerRef              = useRef<HTMLDivElement>(null)
  const esRef                     = useRef<EventSource | null>(null)
  const callIdMap                 = useRef<Map<string, string>>(new Map())

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

    const validType = (['start','success','fail','reject','llm','tool','info'].includes(level)
      ? level : 'info') as LogEntry['type']
    setLogs(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, time, stageKey, stage: getStageName(stageKey), message, type: validType, streaming: false }])
  }, [])

  useEffect(() => {
    if (!runId) { setLogs([]); setConnected(false); return }
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setLogs([])
    callIdMap.current.clear()
    const es = new EventSource(`/api/runs/${runId}/logs/stream`)
    esRef.current = es
    es.onopen    = () => setConnected(true)
    es.onmessage = (ev) => { try { handleEvent(JSON.parse(ev.data)); } catch { /* ignore */ } }
    es.onerror   = () => setConnected(false)
    return () => { es.close(); esRef.current = null; setConnected(false) }
  }, [runId, handleEvent])

  const activeStage = stages.find(s => s.status === 'running')

  return (
    <div className="h-full flex flex-col font-mono text-xs" style={{ background: 'rgba(0,0,0,0.35)' }}>
      {/* Terminal title bar */}
      <div
        className="shrink-0 flex items-center gap-2 px-4 py-2"
        style={{
          background: 'rgba(0,0,0,0.35)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f56' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
        </div>
        <div className="h-3.5 w-px mx-1" style={{ background: 'rgba(255,255,255,0.07)' }} />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.14em]">AI 思考日志</span>

        <div className="ml-auto flex items-center gap-3">
          {runId && (
            <div className={`flex items-center gap-1.5 text-[10px] font-medium ${connected ? 'text-emerald-400' : 'text-slate-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-700'}`} />
              {connected ? '实时' : '等待中'}
            </div>
          )}
          {activeStage && (
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#93c5fd]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#60a5fa] animate-pulse" />
              实时推理中
            </div>
          )}
        </div>
      </div>

      {/* Log rows */}
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-700 text-[11px]">
            {runId ? '正在连接日志流...' : '等待流水线启动...'}
          </div>
        )}

        {logs.map(log => {
          const c    = TYPE_CONFIG[log.type]
          const badge = STAGE_BADGE[log.stageKey]
          return (
            <div
              key={log.id}
              className="flex items-start min-h-[20px] hover:bg-white/[0.02] transition-colors"
              style={{
                borderLeft: `2px solid ${c.bar}33`,
                background: c.rowBg,
              }}
            >
              {/* Time */}
              <span className="shrink-0 text-slate-700 px-2.5 py-0.5 w-[68px] tabular-nums">{log.time}</span>

              {/* Type prefix */}
              <span className="shrink-0 w-5 py-0.5 text-center" style={{ color: c.text }}>{c.prefix}</span>

              {/* Stage badge */}
              {badge ? (
                <span
                  className="shrink-0 text-[9px] font-bold px-1.5 py-[1px] rounded mx-1 my-0.5 tabular-nums"
                  style={{ background: `${c.bar}22`, color: c.text, border: `1px solid ${c.bar}33` }}
                >
                  {badge}
                </span>
              ) : (
                <span className="shrink-0 w-[40px] py-0.5 text-slate-700 px-1">[sys]</span>
              )}

              {/* Stage name */}
              <span className="shrink-0 text-slate-600 py-0.5 min-w-[64px] mr-2">{log.stage}</span>

              {/* Message */}
              <span className="text-slate-300 py-0.5 pr-4 break-all leading-relaxed whitespace-pre-wrap">
                {log.message}
                {log.streaming && (
                  <span
                    className="inline-block w-1.5 h-3 ml-0.5 translate-y-[2px] animate-blink"
                    style={{ background: '#a78bfa', opacity: 0.85 }}
                  />
                )}
              </span>
            </div>
          )
        })}

        {/* Active cursor */}
        {activeStage && (
          <div
            className="flex items-center min-h-[20px]"
            style={{ borderLeft: '2px solid rgba(99,132,255,0.45)', background: 'rgba(59,130,246,0.04)' }}
          >
            <span className="shrink-0 text-slate-700 px-2.5 py-0.5 w-[68px] tabular-nums">{nowStr()}</span>
            <span className="shrink-0 w-5 py-0.5 text-center text-[#60a5fa]">▶</span>
            <span
              className="shrink-0 text-[9px] font-bold px-1.5 py-[1px] rounded mx-1 my-0.5"
              style={{ background: 'rgba(59,130,246,0.20)', color: '#93c5fd', border: '1px solid rgba(99,132,255,0.30)' }}
            >
              {STAGE_BADGE[activeStage.stage_key] || '...'}
            </span>
            <span className="shrink-0 text-slate-600 py-0.5 min-w-[64px] mr-2">
              {STAGES.find(s => s.key === activeStage.stage_key)?.label}
            </span>
            <span className="text-[#60a5fa] py-0.5">推理中</span>
            <span
              className="inline-block w-1.5 h-3 ml-1.5 translate-y-[2px] animate-blink"
              style={{ background: '#60a5fa', opacity: 0.85 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
