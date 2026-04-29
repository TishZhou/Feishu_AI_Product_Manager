import { useMemo } from 'react'
import ReactFlow, { Position, Handle } from 'reactflow'
import type { Node, Edge } from 'reactflow'
import { STAGES, CHECKPOINT_AFTER } from '../types/api'
import type { StageStatus, RunStatus } from '../types/api'
import type { StageResult } from '../types/api'
import { Check, X, RotateCcw, GitMerge } from 'lucide-react'

interface PipelineGraphProps {
  stages: StageResult[]
  runStatus: RunStatus
}

const StageNode = ({ data }: { data: { label: string; status: StageStatus; index: number } }) => {
  const isRunning = data.status === 'running'
  const isSuccess = data.status === 'succeeded'
  const isFailed = data.status === 'failed'
  const isRejected = data.status === 'rejected'
  const isPending = data.status === 'pending'

  const containerStyle = () => {
    if (isRunning) return {
      border: '1px solid rgba(51,112,255,0.5)',
      background: 'linear-gradient(135deg, rgba(51,112,255,0.15) 0%, rgba(51,112,255,0.06) 100%)',
      boxShadow: '0 0 20px rgba(51,112,255,0.25), inset 0 1px 0 rgba(255,255,255,0.08)',
    }
    if (isSuccess) return {
      border: '1px solid rgba(0,180,42,0.4)',
      background: 'linear-gradient(135deg, rgba(0,180,42,0.12) 0%, rgba(0,180,42,0.05) 100%)',
      boxShadow: '0 0 12px rgba(0,180,42,0.15)',
    }
    if (isFailed) return {
      border: '1px solid rgba(239,68,68,0.4)',
      background: 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.05) 100%)',
      boxShadow: '0 0 12px rgba(239,68,68,0.15)',
    }
    if (isRejected) return {
      border: '1px solid rgba(245,158,11,0.4)',
      background: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.05) 100%)',
    }
    return {
      border: '1px solid rgba(255,255,255,0.07)',
      background: 'rgba(255,255,255,0.03)',
    }
  }

  return (
    <div
      className="px-3 py-2.5 rounded-xl min-w-[160px] flex items-center gap-2.5 relative"
      style={containerStyle()}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0 !w-0 !h-0" />

      {/* Multi-layer ping for running state */}
      {isRunning && (
        <>
          <div className="animate-ping-1 absolute inset-0 rounded-xl border border-[#3370ff] opacity-30 pointer-events-none" />
          <div className="animate-ping-2 absolute inset-0 rounded-xl border border-[#3370ff] opacity-15 pointer-events-none" />
          <div className="animate-ping-3 absolute inset-0 rounded-xl border border-[#3370ff] opacity-08 pointer-events-none" />
        </>
      )}

      {/* Index badge */}
      <div
        className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{
          background: isRunning ? 'rgba(51,112,255,0.3)' :
                      isSuccess ? 'rgba(0,180,42,0.3)' :
                      isFailed  ? 'rgba(239,68,68,0.3)' :
                      'rgba(255,255,255,0.06)',
          color: isRunning ? '#6699ff' : isSuccess ? '#00d032' : isFailed ? '#f87171' : '#64748b',
        }}
      >
        {data.index}
      </div>

      <span className={`text-xs font-medium flex-1 ${isPending ? 'text-slate-500' : 'text-white'}`}>
        {data.label}
      </span>

      {isSuccess && <Check className="w-3.5 h-3.5 text-[#00b42a] shrink-0" />}
      {isFailed && <X className="w-3.5 h-3.5 text-[#ef4444] shrink-0" />}
      {isRejected && <RotateCcw className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" />}
      {isRunning && (
        <div className="w-1.5 h-1.5 rounded-full bg-[#3370ff] shrink-0 animate-glow-pulse" />
      )}

      <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-0 !h-0" />
    </div>
  )
}

const CheckpointNode = ({ data }: { data: { active: boolean; label: string } }) => (
  <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg"
    style={{
      background: data.active ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${data.active ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.06)'}`,
      boxShadow: data.active ? '0 0 16px rgba(245,158,11,0.25)' : 'none',
    }}
  >
    <Handle type="target" position={Position.Top} className="!opacity-0 !w-0 !h-0" />
    <GitMerge
      className={`w-3 h-3 ${data.active ? 'text-[#f59e0b]' : 'text-slate-600'}`}
      style={data.active ? { filter: 'drop-shadow(0 0 4px rgba(245,158,11,0.6))' } : {}}
    />
    <span className={`text-[10px] font-mono ${data.active ? 'text-[#f59e0b]' : 'text-slate-600'}`}>
      {data.label}
    </span>
    {data.active && (
      <div className="absolute inset-0 rounded-lg border border-[#f59e0b] animate-ping-1 opacity-20 pointer-events-none" />
    )}
    <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-0 !h-0" />
  </div>
)

const nodeTypes = {
  stage: StageNode,
  checkpoint: CheckpointNode,
}

export function PipelineGraph({ stages, runStatus }: PipelineGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const nds: Node[] = []
    const eds: Edge[] = []
    let yPos = 40
    let prevId: string | null = null

    STAGES.forEach((stageDef) => {
      const result = stages.find(s => s.stage_key === stageDef.key)
      const status = result?.status || 'pending'
      const id = `stage-${stageDef.key}`

      nds.push({
        id,
        type: 'stage',
        position: { x: 20, y: yPos },
        data: { label: stageDef.label, status, index: stageDef.index },
      })

      if (prevId) {
        const isActive = status === 'running'
        const isPrevSuccess = stages.find(s => s.stage_key === prevId?.replace('stage-', ''))?.status === 'succeeded'
        eds.push({
          id: `e-${prevId}-${id}`,
          source: prevId,
          target: id,
          animated: isActive,
          className: isActive ? 'flow-edge-animated' : '',
          style: {
            stroke: isActive ? '#3370ff' : isPrevSuccess ? 'rgba(0,180,42,0.5)' : 'rgba(51,65,85,0.6)',
            strokeWidth: isActive ? 2.5 : 1.5,
          },
        })
      }

      prevId = id
      yPos += 80

      const cpNum = CHECKPOINT_AFTER[stageDef.key]
      if (cpNum) {
        const cpId = `cp-${cpNum}`
        nds.push({
          id: cpId,
          type: 'checkpoint',
          position: { x: 40, y: yPos - 20 },
          data: { active: runStatus === 'waiting_for_approval', label: `检查点 ${cpNum}` },
        })
        eds.push({
          id: `e-${prevId}-${cpId}`,
          source: prevId,
          target: cpId,
          style: { stroke: 'rgba(51,65,85,0.5)', strokeWidth: 1.5, strokeDasharray: '4 3' },
        })
        prevId = cpId
        yPos += 52
      }
    })

    return { nodes: nds, edges: eds }
  }, [stages, runStatus])

  return (
    <div className="flex-1 w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={true}
        zoomOnScroll={false}
      >
      </ReactFlow>
    </div>
  )
}
