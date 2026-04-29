import { useMemo } from 'react'
import ReactFlow, { Background, Position, Handle } from 'reactflow'
import type { Node, Edge } from 'reactflow'
import { STAGES, CHECKPOINT_AFTER } from '../types/api'
import type { StageStatus, RunStatus } from '../types/api'
import type { StageResult } from '../types/api'
import { Check, X, RotateCcw } from 'lucide-react'

interface PipelineGraphProps {
  stages: StageResult[]
  runStatus: RunStatus
}

const StageNode = ({ data }: { data: { label: string, status: StageStatus } }) => {
  const getStyle = () => {
    switch (data.status) {
      case 'running': return 'border-[#3370ff] bg-[#3370ff]/10 text-white shadow-[0_0_15px_rgba(51,112,255,0.5)]'
      case 'succeeded': return 'border-[#00b42a] bg-[#00b42a]/10 text-white'
      case 'failed': return 'border-[#ef4444] bg-[#ef4444]/10 text-white'
      case 'rejected': return 'border-[#f59e0b] bg-[#f59e0b]/10 text-white'
      default: return 'border-white/10 bg-white/5 text-slate-400'
    }
  }

  return (
    <div className={`px-4 py-3 rounded-lg border-2 min-w-[180px] flex items-center justify-between relative ${getStyle()}`}>
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      {data.status === 'running' && (
        <div className="absolute inset-0 rounded-lg border border-[#3370ff] animate-ping opacity-20 pointer-events-none" />
      )}
      <span className="text-sm font-medium">{data.label}</span>
      {data.status === 'succeeded' && <Check className="w-4 h-4 text-[#00b42a]" />}
      {data.status === 'failed' && <X className="w-4 h-4 text-[#ef4444]" />}
      {data.status === 'rejected' && <RotateCcw className="w-4 h-4 text-[#f59e0b]" />}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

const CheckpointNode = ({ data }: { data: { active: boolean } }) => (
  <div className="relative flex items-center justify-center w-8 h-8">
    <Handle type="target" position={Position.Top} className="!opacity-0" />
    <div className={`w-4 h-4 rotate-45 border-2 transition-colors duration-300 ${
      data.active 
        ? 'bg-[#f59e0b] border-[#f59e0b] shadow-[0_0_10px_rgba(245,158,11,0.5)]' 
        : 'bg-slate-800 border-slate-600'
    }`} />
    <Handle type="source" position={Position.Bottom} className="!opacity-0" />
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
    let yPos = 50

    let prevId: string | null = null

    STAGES.forEach((stageDef) => {
      const result = stages.find(s => s.stage_key === stageDef.key)
      const status = result?.status || 'pending'
      const id = `stage-${stageDef.key}`

      nds.push({
        id,
        type: 'stage',
        position: { x: 100, y: yPos },
        data: { label: stageDef.label, status },
      })

      if (prevId) {
        eds.push({
          id: `e-${prevId}-${id}`,
          source: prevId,
          target: id,
          animated: status === 'running',
          className: status === 'running' ? 'flow-edge-animated' : '',
          style: { stroke: status === 'running' ? '#3370ff' : status === 'succeeded' ? '#00b42a' : '#334155' },
        })
      }

      prevId = id
      yPos += 100

      // Add Checkpoint diamond if needed
      const cpNum = CHECKPOINT_AFTER[stageDef.key]
      if (cpNum) {
        const cpId = `cp-${cpNum}`
        nds.push({
          id: cpId,
          type: 'checkpoint',
          position: { x: 170, y: yPos - 30 },
          data: { active: runStatus === 'waiting_for_approval' },
        })
        
        eds.push({
          id: `e-${prevId}-${cpId}`,
          source: prevId,
          target: cpId,
          style: { stroke: '#334155' },
        })
        prevId = cpId
        yPos += 60
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
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={true}
        zoomOnScroll={true}
      >
        <Background color="#1e293b" gap={16} />
      </ReactFlow>
    </div>
  )
}
