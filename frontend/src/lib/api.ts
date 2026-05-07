import axios from 'axios'
import type {
  Pipeline, PipelineCreate, Run, StageResult, Artifact, Checkpoint,
  GitStatus, GitPublishOptions, GitPublishResult, SourceApplicationStatus,
} from '../types/api'

export const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
})

export const apiClient = {
  // Pipelines
  createPipeline: (data: PipelineCreate) =>
    api.post<Pipeline>('/api/pipelines', data).then((r) => r.data),

  getPipeline: (id: string) =>
    api.get<Pipeline>(`/api/pipelines/${id}`).then((r) => r.data),

  createRun: (pipelineId: string) =>
    api.post<Run>(`/api/pipelines/${pipelineId}/runs`).then((r) => r.data),

  // Runs
  getRun: (runId: string) =>
    api.get<Run>(`/api/runs/${runId}`).then((r) => r.data),

  getRunStages: (runId: string) =>
    api.get<StageResult[]>(`/api/runs/${runId}/stages`).then((r) => r.data),

  getRunArtifacts: (runId: string) =>
    api.get<Artifact[]>(`/api/runs/${runId}/artifacts`).then((r) => r.data),

  getRunCheckpoints: (runId: string) =>
    api.get<Checkpoint[]>(`/api/runs/${runId}/checkpoints`).then((r) => r.data),

  pauseRun: (runId: string) =>
    api.post(`/api/runs/${runId}/pause`).then((r) => r.data),

  resumeRun: (runId: string) =>
    api.post(`/api/runs/${runId}/resume`).then((r) => r.data),

  terminateRun: (runId: string) =>
    api.post(`/api/runs/${runId}/terminate`).then((r) => r.data),

  retryRunFromStage: (runId: string, stageKey: string) =>
    api.post<{ run_id: string; status: string; resumed_from: string }>(
      `/api/runs/${runId}/retry`,
      { stage_key: stageKey },
    ).then((r) => r.data),

  clarifyRun: (runId: string, answers: string, answered_by = 'user') =>
    api.post(`/api/runs/${runId}/clarifications`, { answered_by, answers }).then((r) => r.data),

  getRunClarification: (runId: string) =>
    api.get(`/api/runs/${runId}/clarification`).then((r) => r.data),

  getSourceApplicationStatus: (runId: string) =>
    api.get<SourceApplicationStatus>(`/api/runs/${runId}/source-application`).then((r) => r.data),

  rollbackRun: (runId: string) =>
    api.post(`/api/runs/${runId}/rollback`).then((r) => r.data),

  getGitStatus: (runId: string) =>
    api.get<GitStatus>(`/api/runs/${runId}/git-status`).then((r) => r.data),

  publishRunGit: (runId: string, options: GitPublishOptions) =>
    api.post<GitPublishResult>(`/api/runs/${runId}/git-publish`, options).then((r) => r.data),

  getTestProgress: (runId: string) =>
    api.get(`/api/runs/${runId}/test-progress`).then((r) => r.data),

  getCodeReviewFiles: (runId: string) =>
    api.get(`/api/runs/${runId}/code-review-files`).then((r) => r.data),

  // Checkpoints
  getCheckpoint: (id: string) =>
    api.get<Checkpoint>(`/api/checkpoints/${id}`).then((r) => r.data),

  approveCheckpoint: (id: string, decided_by: string, reason: string, next_provider = '', next_model = '') =>
    api.post<Checkpoint>(`/api/checkpoints/${id}/approve`, { decided_by, reason, next_provider, next_model }).then((r) => r.data),

  rejectCheckpoint: (id: string, decided_by: string, reason: string, retry_stage_key: string, next_provider = '', next_model = '') =>
    api.post<Checkpoint>(`/api/checkpoints/${id}/reject`, { decided_by, reason, retry_stage_key, next_provider, next_model }).then((r) => r.data),

  // Artifacts
  getArtifactContent: async (artifact: Artifact): Promise<string> => {
    try {
      const r = await api.get<string>(`/api/artifacts/${artifact.id}/content`)
      return r.data
    } catch {
      return `# ${artifact.filename}\n\nContent preview not available.`
    }
  },

  // UI Canvas
  suggestLayout: (runId: string, description: string) =>
    api.post<{ modules: { id: string; type: string; name: string; category: string; props: Record<string, unknown> }[]; rationale: string }>(
      `/api/runs/${runId}/ui-canvas/suggest`, { description }
    ).then((r) => r.data),

  generateCanvasCode: (
    runId: string,
    layout: { id: string; type: string; name: string; category: string; props: Record<string, unknown> }[],
    description: string,
    framework = 'html'
  ) =>
    api.post<{ artifact_id: string; filename: string; html_content: string; framework: string }>(
      `/api/runs/${runId}/ui-canvas/generate-code`, { layout, description, framework }
    ).then((r) => r.data),

  refineCanvas: (
    runId: string,
    layout: { id: string; type: string; name: string; category: string; props: Record<string, unknown> }[],
    feedback: string,
    description: string,
    current_html: string,
    framework = 'html'
  ) =>
    api.post<{ html_content: string; message: string; framework: string }>(
      `/api/runs/${runId}/ui-canvas/refine`, { layout, feedback, description, current_html, framework }
    ).then((r) => r.data),

  uploadReferenceDocuments: (files: File[]) => {
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    return api.post<{ reference_context: string; reference_sources: string }>(
      '/api/reference-documents/extract',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    ).then((r) => r.data)
  },

  getTokenUsage: (runId: string) =>
    api.get<Record<string, number>>(`/api/runs/${runId}/token-usage`).then((r) => r.data),

  // Meta
  getMeta: () => api.get('/api/meta').then((r) => r.data),

  getWorkspace: () =>
    api.get<{ path: string }>('/api/workspace').then((r) => r.data),

  listDirectory: (path?: string) =>
    api.get<{ path: string; parent: string | null; entries: { name: string; path: string; is_dir: boolean }[] }>(
      '/api/fs/list',
      { params: path ? { path } : {} }
    ).then((r) => r.data),
}
