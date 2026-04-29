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

const TYPE_COLOR: Record<LogEntry['type'], { text: string; bar: string; prefix: string }> = {
  start:   { text: 'text-[#6699ff]', bar: '#3370ff', prefix: '▶' },
  success: { text: 'text-[#00d032]', bar: '#00b42a', prefix: '✓' },
  fail:    { text: 'text-[#f87171]', bar: '#ef4444', prefix: '✗' },
  reject:  { text: 'text-[#f59e0b]', bar: '#f59e0b', prefix: '↩' },
  llm:     { text: 'text-[#c084fc]', bar: '#a855f7', prefix: '⚡' },
  tool:    { text: 'text-[#38bdf8]', bar: '#0ea5e9', prefix: '⚙' },
  info:    { text: 'text-slate-500',  bar: '#334155', prefix: '·' },
}

const ICON: Record<string, string> = {
  requirement_analysis:   '[需求]',
  solution_architecture:  '[架构]',
  detailed_spec:          '[规格]',
  code_generation:        '[生成]',
  test_generation:        '[测试]',
  code_review:            '[审查]',
  delivery:               '[交付]',
}

function getStageName(stageKey: string): string {
  return STAGES.find(s => s.key === stageKey)?.label || stageKey || '系统'
}

function nowStr(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function LogStream({ stages, runStatus: _runStatus, runId }: LogStreamProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  // Maps call_id → log entry id for token accumulation
  const callIdToEntryId = useRef<Map<string, string>>(new Map())

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  const handleEvent = useCallback((data: Record<string, unknown>) => {
    const stageKey = (data.stage_key as string) || ''
    const level = (data.level as string) || 'info'
    const message = (data.message as string) || ''
    const callId = data.call_id as string | undefined
    const time = (data.time as string) || nowStr()

    // Token events: append to the existing streaming log entry for this call_id
    if (level === 'token' && callId) {
      setLogs(prev => {
        const existingId = callIdToEntryId.current.get(callId)
        if (existingId) {
          return prev.map(e =>
            e.id === existingId
              ? { ...e, message: e.message + message, streaming: true }
              : e
          )
        }
        // No existing entry for this call_id yet — create one
        const newId = `${callId}-${Date.now()}`
        callIdToEntryId.current.set(callId, newId)
        const newEntry: LogEntry = {
          id: newId,
          time,
          stageKey,
          stage: getStageName(stageKey),
          message,
          type: 'llm',
          streaming: true,
        }
        return [...prev, newEntry]
      })
      return
    }

    // llm events with call_id: if there's already a streaming entry for this call_id,
    // mark it as no longer streaming (inference complete) and update message
    if (level === 'llm' && callId) {
      setLogs(prev => {
        const existingId = callIdToEntryId.current.get(callId)
        if (existingId) {
          // This is the completion event — stop streaming cursor
          if (message.includes('推理完成') || message.includes('汇总完成')) {
            callIdToEntryId.current.delete(callId)
            return prev.map(e =>
              e.id === existingId ? { ...e, streaming: false } : e
            )
          }
          return prev
        }
        // Start event (no existing entry) — create metadata entry
        const newId = `llm-meta-${callId}-${Date.now()}`
        const newEntry: LogEntry = {
          id: newId,
          time,
          stageKey,
          stage: getStageName(stageKey),
          message,
          type: 'llm',
          streaming: false,
        }
        return [...prev, newEntry]
      })
      return
    }

    // All other events: create a new log entry
    const validType: LogEntry['type'] = (
      ['start', 'success', 'fail', 'reject', 'llm', 'tool', 'info'].includes(level)
        ? level
        : 'info'
    ) as LogEntry['type']

    setLogs(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        time,
        stageKey,
        stage: getStageName(stageKey),
        message,
        type: validType,
        streaming: false,
      },
    ])
  }, [])

  // Connect to SSE stream when runId changes
  useEffect(() => {
    if (!runId) {
      setLogs([])
      setConnected(false)
      return
    }

    // Close any existing connection
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    setLogs([])
    callIdToEntryId.current.clear()

    // Use relative URL — routed through Vite dev proxy to the backend
    const url = `/api/runs/${runId}/logs/stream`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>
        handleEvent(data)
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      setConnected(false)
    }

    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
    }
  }, [runId, handleEvent])

  const activeStage = stages.find(s => s.status === 'running')

  return (
    <div className="h-full flex flex-col font-mono text-xs">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="w-1.5 h-1.5 rounded-full bg-[#00b42a]" />
        <div className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
        <div className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
        <span className="ml-2 text-[10px] text-slate-500 uppercase tracking-widest">AI 思考日志</span>

        <div className="ml-auto flex items-center gap-3">
          {runId && (
            <div className={`flex items-center gap-1 text-[10px] ${connected ? 'text-[#00d032]' : 'text-slate-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${connected ? 'bg-[#00b42a] animate-pulse' : 'bg-slate-700'}`} />
              {connected ? '实时' : '等待中'}
            </div>
          )}
          {activeStage && (
            <div className="flex items-center gap-1.5 text-[10px] text-[#3370ff]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3370ff] animate-pulse inline-block" />
              实时推理中
            </div>
          )}
        </div>
      </div>

      {/* Log entries */}
      <div ref={containerRef} className="flex-1 overflow-y-auto py-3 space-y-0.5">
        {logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-700 text-[11px]">
            {runId ? '正在连接日志流...' : '等待流水线启动...'}
          </div>
        )}

        {logs.map(log => {
          const c = TYPE_COLOR[log.type]
          const icon = ICON[log.stageKey] || (log.stageKey ? '>>' : '[系统]')
          return (
            <div
              key={log.id}
              className="flex items-start gap-0 hover:bg-white/[0.02] transition-colors"
              style={{ borderLeft: `2px solid ${c.bar}22` }}
            >
              <span className="shrink-0 text-slate-600 px-3 py-0.5 w-[72px]">{log.time}</span>
              <span className={`shrink-0 px-1 py-0.5 w-6 text-center ${c.text}`}>{c.prefix}</span>
              <span className="shrink-0 text-slate-500 py-0.5 w-[52px]">{icon}</span>
              <span className="shrink-0 text-slate-400 py-0.5 min-w-[80px] mr-3">{log.stage}</span>
              <span className="text-slate-300 py-0.5 pr-4 break-all leading-relaxed whitespace-pre-wrap">
                {log.message}
                {log.streaming && (
                  <span className="w-2 h-3.5 bg-[#a855f7] inline-block animate-blink ml-0.5 translate-y-0.5 opacity-80" />
                )}
              </span>
            </div>
          )
        })}

        {/* Active cursor line */}
        {activeStage && (
          <div
            className="flex items-center gap-0 mt-1"
            style={{ borderLeft: '2px solid rgba(51,112,255,0.4)' }}
          >
            <span className="shrink-0 text-slate-600 px-3 py-0.5 w-[72px]">
              {nowStr()}
            </span>
            <span className="shrink-0 text-[#3370ff] px-1 py-0.5 w-6 text-center">▶</span>
            <span className="shrink-0 text-slate-500 py-0.5 w-[52px]">
              {ICON[activeStage.stage_key] || '>>'}
            </span>
            <span className="shrink-0 text-slate-400 py-0.5 min-w-[80px] mr-3">
              {STAGES.find(s => s.key === activeStage.stage_key)?.label}
            </span>
            <span className="text-[#3370ff] py-0.5">推理中</span>
            <span className="w-2 h-3.5 bg-[#3370ff] inline-block animate-blink ml-1.5 translate-y-0.5 opacity-80" />
          </div>
        )}
      </div>
    </div>
  )
}
