export interface Pipeline {
  id: string
  name: string
  description: string
  task_type: string
  repo_path: string
  provider: string
  model: string
  created_at: string
}

export interface PipelineCreate {
  name: string
  description: string
  task_type?: string
  repo_path: string
  provider?: string
  model?: string
}

export interface Run {
  id: string
  pipeline_id: string
  run_number: number
  status: RunStatus
  current_stage: string
  error_message: string
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type RunStatus =
  | 'created'
  | 'running'
  | 'waiting_for_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'terminated'

export interface StageResult {
  id: string
  run_id: string
  stage_key: string
  stage_index: number
  status: StageStatus
  attempt: number
  provider: string
  model: string
  error_message: string
  started_at: string | null
  completed_at: string | null
  duration_seconds: number
  output_artifact_keys: string
}

export type StageStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'skipped'

export interface Artifact {
  id: string
  run_id: string
  stage_key: string
  filename: string
  file_path: string
  content_type: string
  size_bytes: number
  created_at: string
}

export interface Checkpoint {
  id: string
  run_id: string
  checkpoint_number: number
  label: string
  required_stage_keys: string
  retry_stage_key: string
  status: 'waiting' | 'approved' | 'rejected'
  decision_by: string
  decision_reason: string
  decided_at: string | null
  created_at: string
}

export const STAGES = [
  { key: 'requirement_analysis', label: 'Requirement Analysis', index: 1 },
  { key: 'solution_architecture', label: 'Architecture Design', index: 2 },
  { key: 'detailed_spec', label: 'Detailed Spec', index: 3 },
  { key: 'code_generation', label: 'Code Generation', index: 4 },
  { key: 'test_generation', label: 'Test Generation', index: 5 },
  { key: 'code_review', label: 'Code Review', index: 6 },
  { key: 'delivery', label: 'Delivery', index: 7 },
] as const

export const STAGE_KEYS = STAGES.map((s) => s.key)

export const CHECKPOINT_AFTER: Record<string, number> = {
  detailed_spec: 1,
  code_review: 2,
}
