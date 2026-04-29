import { useMemo } from 'react'
import type { StageResult, Artifact } from '../types/api'
import { STAGES } from '../types/api'
import { FileCode2, Clock, Cpu, AlertTriangle, Hash } from 'lucide-react'

interface StageDetailProps {
  stages: StageResult[]
  artifacts: Artifact[]
  onSelectArtifact: (artifact: Artifact) => void
}

const STATUS_CN: Record<string, string> = {
  running: '运行中',
  succeeded: '已完成',
  failed: '已失败',
  rejected: '已拒绝',
  pending: '等待中',
  skipped: '已跳过',
}

const STATUS_STYLE: Record<string, string> = {
  running: 'text-[#6699ff] border-[#3370ff]/40',
  succeeded: 'text-[#00d032] border-[#00b42a]/40',
  failed: 'text-[#f87171] border-[#ef4444]/40',
  rejected: 'text-[#f59e0b] border-[#f59e0b]/40',
  pending: 'text-slate-500 border-slate-700',
  skipped: 'text-slate-500 border-slate-700',
}

const STATUS_BG: Record<string, string> = {
  running: 'rgba(51,112,255,0.1)',
  succeeded: 'rgba(0,180,42,0.1)',
  failed: 'rgba(239,68,68,0.1)',
  rejected: 'rgba(245,158,11,0.1)',
  pending: 'rgba(255,255,255,0.03)',
  skipped: 'rgba(255,255,255,0.03)',
}

export function StageDetail({ stages, artifacts, onSelectArtifact }: StageDetailProps) {
  const activeStage = useMemo(() => {
    if (stages.length === 0) return null
    const running = stages.find(s => s.status === 'running')
    if (running) return running
    return stages[stages.length - 1]
  }, [stages])

  if (!activeStage) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Cpu className="w-5 h-5 text-slate-600" />
          </div>
          <p className="text-sm text-slate-600">等待流水线启动</p>
        </div>
      </div>
    )
  }

  const stageDef = STAGES.find(s => s.key === activeStage.stage_key)
  const stageArtifacts = artifacts.filter(a => a.stage_key === activeStage.stage_key)
  const st = activeStage.status

  return (
    <div className="space-y-5">
      {/* Stage header */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">当前阶段</p>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight truncate">
            {stageDef?.label || activeStage.stage_key}
          </h2>

          <div className="flex items-center flex-wrap gap-2 mt-2.5">
            {/* Status badge */}
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLE[st]}`}
              style={{ background: STATUS_BG[st] }}
            >
              {STATUS_CN[st] || st}
            </span>

            {/* Provider/model */}
            {activeStage.provider && (
              <div className="flex items-center gap-1 text-xs text-slate-500 font-mono">
                <Cpu className="w-3 h-3" />
                <span>{activeStage.provider}</span>
                {activeStage.model && <span className="text-slate-600">/ {activeStage.model}</span>}
              </div>
            )}

            {/* Duration */}
            {activeStage.duration_seconds > 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500 font-mono">
                <Clock className="w-3 h-3" />
                <span>{activeStage.duration_seconds}s</span>
              </div>
            )}
          </div>
        </div>

        {/* Attempt badge */}
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg shrink-0"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Hash className="w-3 h-3 text-slate-600" />
          <span className="text-xs font-mono text-slate-500">第 {activeStage.attempt} 次</span>
        </div>
      </div>

      {/* Error message */}
      {activeStage.error_message && (
        <div className="flex gap-3 p-4 rounded-xl text-sm font-mono"
          style={{
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderLeft: '3px solid rgba(239,68,68,0.6)',
          }}>
          <AlertTriangle className="w-4 h-4 text-[#ef4444] shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-[#f87171] text-xs leading-relaxed">{activeStage.error_message}</pre>
        </div>
      )}

      {/* Artifacts */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2.5">输出产物</p>
        {stageArtifacts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stageArtifacts.map(artifact => (
              <button
                key={artifact.id}
                onClick={() => onSelectArtifact(artifact)}
                className="artifact-chip flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-mono text-slate-300"
              >
                <FileCode2 className="w-3.5 h-3.5 text-[#3370ff]" />
                <span className="text-xs">{artifact.filename}</span>
                <span className="text-[10px] text-slate-600">
                  {(artifact.size_bytes / 1024).toFixed(1)}k
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600 italic">暂无产物生成</p>
        )}
      </div>

      {/* All stages mini progress */}
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">全部阶段</p>
        <div className="flex gap-1.5">
          {STAGES.map((s) => {
            const r = stages.find(sr => sr.stage_key === s.key)
            const rs = r?.status || 'pending'
            return (
              <div
                key={s.key}
                title={s.label}
                className="h-1 flex-1 rounded-full transition-all"
                style={{
                  background:
                    rs === 'succeeded' ? '#00b42a' :
                    rs === 'running' ? '#3370ff' :
                    rs === 'failed' ? '#ef4444' :
                    rs === 'rejected' ? '#f59e0b' :
                    'rgba(255,255,255,0.07)',
                  boxShadow:
                    rs === 'running' ? '0 0 8px rgba(51,112,255,0.6)' : 'none',
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
