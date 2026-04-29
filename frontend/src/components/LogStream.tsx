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
  icon: string
  stage: string
  message: string
}

function getIcon(stageKey: string): string {
  if (['requirement_analysis', 'solution_architecture', 'code_review'].includes(stageKey)) return '>>'
  if (stageKey === 'code_generation') return '[gen]'
  if (stageKey === 'test_generation') return '[test]'
  if (stageKey === 'delivery') return '[ship]'
  return '>>'
}

export function LogStream({ stages, runStatus: _runStatus }: LogStreamProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const prevStagesRef = useRef<StageResult[]>([])

  useEffect(() => {
    const newLogs: LogEntry[] = []
    const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

    stages.forEach(stage => {
      const prev = prevStagesRef.current.find(s => s.id === stage.id)
      const stageName = STAGES.find(s => s.key === stage.stage_key)?.label || stage.stage_key
      const icon = getIcon(stage.stage_key)

      if (!prev && stage.status === 'running') {
        newLogs.push({ id: Math.random().toString(), time: now, icon, stage: stageName, message: 'Started processing...' })
      } else if (prev?.status !== stage.status) {
        if (stage.status === 'succeeded') {
          newLogs.push({ id: Math.random().toString(), time: now, icon, stage: stageName, message: `Completed in ${stage.duration_seconds}s` })
        } else if (stage.status === 'failed') {
          newLogs.push({ id: Math.random().toString(), time: now, icon, stage: stageName, message: 'Failed execution' })
        } else if (stage.status === 'rejected') {
          newLogs.push({ id: Math.random().toString(), time: now, icon, stage: stageName, message: 'Rejected at checkpoint' })
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
    <div className="h-full flex flex-col font-mono text-xs p-4">
      <div className="text-slate-500 mb-2 uppercase tracking-widest text-[10px]">Observability Stream</div>
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-1.5 pb-8"
      >
        {logs.map(log => (
          <div key={log.id} className="flex items-start gap-3 hover:bg-white/5 rounded px-1 transition-colors">
            <span className="text-slate-500 shrink-0">[{log.time}]</span>
            <span className="text-[#3370ff] shrink-0 font-bold">{log.icon}</span>
            <span className="text-slate-400 shrink-0 min-w-[140px]">{log.stage}</span>
            <span className="text-slate-300 break-all">{log.message}</span>
          </div>
        ))}
        {activeStage && (
          <div className="flex items-start gap-3 px-1 mt-2">
            <span className="text-slate-500 shrink-0">[{new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
            <span className="text-[#3370ff] shrink-0 font-bold">[...]</span>
            <span className="text-slate-400 shrink-0 min-w-[140px]">{STAGES.find(s => s.key === activeStage.stage_key)?.label}</span>
            <span className="text-[#3370ff]">Processing</span>
            <span className="w-2 h-3 bg-[#3370ff] inline-block animate-blink ml-1 translate-y-0.5" />
          </div>
        )}
      </div>
    </div>
  )
}
