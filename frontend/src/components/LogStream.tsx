import { useEffect, useRef, useState } from 'react'
import type { StageResult, RunStatus } from '../types/api'
import { STAGES } from '../types/api'

interface LogStreamProps {
  stages: StageResult[]
  runStatus: RunStatus
}

interface LogEntry {
  id: string
  time: string
  stageKey: string
  stage: string
  message: string
  type: 'start' | 'success' | 'fail' | 'reject' | 'info'
}

const TYPE_COLOR = {
  start:   { dot: '#3370ff', text: 'text-[#6699ff]', bar: '#3370ff', prefix: '▶' },
  success: { dot: '#00b42a', text: 'text-[#00d032]', bar: '#00b42a', prefix: '✓' },
  fail:    { dot: '#ef4444', text: 'text-[#f87171]', bar: '#ef4444', prefix: '✗' },
  reject:  { dot: '#f59e0b', text: 'text-[#f59e0b]', bar: '#f59e0b', prefix: '↩' },
  info:    { dot: '#64748b', text: 'text-slate-500',  bar: '#334155', prefix: '·' },
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

export function LogStream({ stages, runStatus: _runStatus }: LogStreamProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const prevStagesRef = useRef<StageResult[]>([])

  const now = () => new Date().toLocaleTimeString('zh-CN', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  useEffect(() => {
    const newLogs: LogEntry[] = []
    const t = now()

    stages.forEach(stage => {
      const prev = prevStagesRef.current.find(s => s.id === stage.id)
      const stageName = STAGES.find(s => s.key === stage.stage_key)?.label || stage.stage_key

      if (!prev && stage.status === 'running') {
        newLogs.push({ id: Math.random().toString(), time: t, stageKey: stage.stage_key, stage: stageName, message: '开始处理...', type: 'start' })
      } else if (prev?.status !== stage.status) {
        if (stage.status === 'succeeded') {
          newLogs.push({ id: Math.random().toString(), time: t, stageKey: stage.stage_key, stage: stageName, message: `完成，耗时 ${stage.duration_seconds}s`, type: 'success' })
        } else if (stage.status === 'failed') {
          newLogs.push({ id: Math.random().toString(), time: t, stageKey: stage.stage_key, stage: stageName, message: '执行失败', type: 'fail' })
        } else if (stage.status === 'rejected') {
          newLogs.push({ id: Math.random().toString(), time: t, stageKey: stage.stage_key, stage: stageName, message: '审核拒绝，准备重试', type: 'reject' })
        } else if (stage.status === 'running') {
          newLogs.push({ id: Math.random().toString(), time: t, stageKey: stage.stage_key, stage: stageName, message: '开始处理...', type: 'start' })
        }
      }
    })

    if (newLogs.length > 0) {
      setLogs(prev => [...prev, ...newLogs])
    }

    prevStagesRef.current = stages
  }, [stages])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

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
        {activeStage && (
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[#3370ff]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3370ff] animate-pulse inline-block" />
            实时推理中
          </div>
        )}
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto py-3 space-y-0.5"
      >
        {logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-700 text-[11px]">
            等待流水线日志...
          </div>
        )}

        {logs.map(log => {
          const c = TYPE_COLOR[log.type]
          const icon = ICON[log.stageKey] || '>>'
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
              <span className="text-slate-300 py-0.5 pr-4 break-all leading-relaxed">{log.message}</span>
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
              {now()}
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
