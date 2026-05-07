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
  reference_context?: string
  reference_sources?: string
  confirm_self_modification?: boolean
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

export const STAGES = [
  { key: 'requirement_analysis',  label: '需求分析', index: 1 },
  { key: 'solution_architecture', label: '架构设计', index: 2 },
  { key: 'detailed_spec',         label: '详细规格', index: 3 },
  { key: 'code_generation',       label: '代码生成', index: 4 },
  { key: 'test_generation',       label: '测试生成', index: 5 },
  { key: 'code_review',           label: '代码审查', index: 6 },
  { key: 'delivery',              label: '交付打包', index: 7 },
] as const

export const STAGE_KEYS = STAGES.map((s) => s.key)

export const CHECKPOINT_AFTER: Record<string, number> = {
  detailed_spec: 1,
  code_review: 2,
}

export interface TestCaseResult {
  id?: string
  name?: string
  status?: 'passed' | 'failed' | 'skipped' | 'running' | string
  message?: string
}

export interface GeneratedTestFile {
  path?: string
  content?: string
  rationale?: string
  truncated?: boolean
  error?: string
}

export interface CommandRunResult {
  command?: string
  normalized_command?: string
  cwd?: string
  success?: boolean
  exit_code?: number
  stdout?: string
  stderr?: string
  summary?: string
  error?: string
  duration_seconds?: number
}

export interface TestRunResult {
  test_path?: string
  success?: boolean
  exit_code?: number
  stdout?: string
  stderr?: string
  error?: string
  summary?: string
  duration_seconds?: number
  counts?: {
    total?: number
    passed?: number
    failed?: number
    errors?: number
    skipped?: number
  }
}

export interface TestReport {
  test_file?: string
  test_files?: string[]
  test_command?: string
  summary?: string
  error_log?: string
  total?: number
  passed?: number
  failed?: number
  skipped?: number
  exit_code?: number
  test_cases?: TestCaseResult[]
  generated_test_files?: GeneratedTestFile[]
  runner_validation?: {
    runs?: TestRunResult[]
    commands?: CommandRunResult[]
  }
}

export interface SourceApplicationStatus {
  applied: boolean
  rolled_back?: boolean
  applied_at?: string
  rolled_back_at?: string
  source_repo?: string
  files?: string[]
}

export interface GitStatus {
  is_git: boolean
  repo_path: string
  current_branch: string
  remote_url: string
  remote_kind: '' | 'github' | 'gitlab'
  working_tree_clean: boolean
  has_gh_cli: boolean
  has_glab_cli: boolean
  error: string
  already_published: boolean
  last_publication?: GitPublishResult | null
}

export interface GitPublishOptions {
  do_push: boolean
  do_pr: boolean
  branch_prefix?: string
  title?: string
  body?: string
}

export interface GitPublishResult {
  status: 'pending' | 'committed' | 'pushed' | 'review_created' | 'failed' | 'blocked' | 'skipped'
  repo_path: string
  run_id: string
  base_branch: string
  branch: string
  commit: string
  remote: string
  pushed: boolean
  review_url: string
  review_kind: string
  changed_files: string[]
  error: string
  steps?: { cmd: string; returncode: number; stdout: string; stderr: string }[]
  working_tree_status?: string
}

export interface TestProgress {
  status: 'idle' | 'preparing' | 'running' | 'passed' | 'failed' | string
  total?: number
  passed?: number
  failed?: number
  skipped?: number
  active_test_path?: string
  test_files?: string[]
  test_cases?: TestCaseResult[]
  runs?: TestRunResult[]
  events?: {
    stream: string
    line: string
  }[]
}
