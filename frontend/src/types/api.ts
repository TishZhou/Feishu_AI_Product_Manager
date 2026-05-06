export interface Pipeline {
  id: string
  name: string
  description: string
  task_type: string
  repo_path: string
  reference_context: string
  reference_sources: string
  provider: string
  model: string
  created_at: string
}

export interface PipelineCreate {
  name: string
  description: string
  task_type?: string
  repo_path: string
  reference_context?: string
  reference_sources?: string
  provider?: string
  model?: string
  confirm_self_modification?: boolean
}

export interface RepoCheck {
  path: string
  exists: boolean
  is_directory?: boolean
  is_self_repo?: boolean
  is_git_repo?: boolean
  source_root?: string
}

export interface SourceApplicationStatus {
  applied: boolean
  rolled_back: boolean
  applied_at?: string
  rolled_back_at?: string
  source_repo?: string
  files?: string[]
}

export interface RollbackResult {
  status: 'rolled_back' | 'already_rolled_back' | 'not_found' | 'failed' | string
  run_id: string
  restored_files?: string[]
  removed_files?: string[]
  error?: string
}

export interface ReferenceDocumentContext {
  reference_context: string
  reference_sources: string
}

export interface ClarificationSubmit {
  answered_by?: string
  answers: string
}

export interface ClarificationPayload {
  title?: string
  summary?: string
  open_questions?: unknown[]
  missing_critical_info?: unknown[]
  ambiguities?: unknown[]
  confidence_score?: number | string | null
  instruction?: string
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
  | 'waiting_for_clarification'
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

export interface CodeReviewFile {
  path: string
  action: 'create' | 'modify' | 'delete' | string
  diff: string
  additions: number
  deletions: number
  generated_file: string
  generated_exists: boolean
  generated_content: string
}

export interface CodeReviewFilesPayload {
  mode: string
  applied_to_repo: boolean
  patch_applied_to_workspace: boolean
  workspace_apply_error: string
  execution_workspace: string
  source_artifacts?: Record<string, string>
  file_count: number
  files: CodeReviewFile[]
}

export interface TestCaseResult {
  id?: string
  name?: string
  status?: 'passed' | 'failed' | 'skipped' | string
  message?: string
}

export interface GeneratedTestFile {
  path: string
  content: string
  truncated?: boolean
  error?: string
}

export interface TestRunResult {
  success?: boolean
  exit_code?: number
  test_path?: string
  total?: number
  counts?: {
    passed?: number
    failed?: number
    skipped?: number
    errors?: number
  }
  summary?: string
  stdout?: string
  stderr?: string
  error?: string
  duration_seconds?: number
}

export interface CommandRunResult {
  command?: string
  normalized_command?: string
  cwd?: string
  success?: boolean
  exit_code?: number
  stdout?: string
  stderr?: string
  error?: string
  summary?: string
  duration_seconds?: number
  blocked?: boolean
}

export interface TestReport {
  test_file?: string
  test_files?: string[]
  test_command?: string
  total?: number
  passed?: number
  failed?: number
  skipped?: number
  exit_code?: number
  test_cases?: TestCaseResult[]
  error_log?: string
  summary?: string
  generated_test_files?: GeneratedTestFile[]
  runner_validation?: {
    validated?: boolean
    runs?: TestRunResult[]
    commands?: CommandRunResult[]
  }
}

export interface TestProgressEvent {
  time: string
  stream: 'stdout' | 'stderr' | 'system' | string
  line: string
}

export interface TestProgress {
  run_id: string
  status: 'idle' | 'preparing' | 'running' | 'passed' | 'failed' | string
  active_test_path: string
  test_files: string[]
  test_cases: TestCaseResult[]
  runs: TestRunResult[]
  events: TestProgressEvent[]
  total: number
  passed: number
  failed: number
  skipped: number
  exit_code?: number | null
  started_at?: string | null
  updated_at?: string | null
}

export const STAGES = [
  { key: 'requirement_analysis', label: '需求分析', index: 1 },
  { key: 'solution_architecture', label: '架构设计', index: 2 },
  { key: 'detailed_spec', label: '详细规格', index: 3 },
  { key: 'code_generation', label: '代码生成', index: 4 },
  { key: 'test_generation', label: '测试生成', index: 5 },
  { key: 'code_review', label: '代码审查', index: 6 },
  { key: 'delivery', label: '交付打包', index: 7 },
] as const

export const STAGE_KEYS = STAGES.map((s) => s.key)

export const CHECKPOINT_AFTER: Record<string, number> = {
  detailed_spec: 1,
  code_review: 2,
  delivery: 3,
}
