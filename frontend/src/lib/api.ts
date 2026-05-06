import axios from 'axios'
import type {
  Pipeline,
  PipelineCreate,
  RepoCheck,
  RollbackResult,
  Run,
  SourceApplicationStatus,
  StageResult,
  Artifact,
  Checkpoint,
  ReferenceDocumentContext,
  ClarificationSubmit,
  ClarificationPayload,
  CodeReviewFilesPayload,
  TestProgress,
} from '../types/api'

export const DEFAULT_REPO_PATH =
  import.meta.env.VITE_DEFAULT_REPO_PATH ||
  '/Users/tish/Desktop/bytedance/Feishu_AI_Product_Manager'

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

  extractReferenceDocuments: (files: File[]) => {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    return api.post<ReferenceDocumentContext>('/api/reference-documents/extract', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },

  // Runs
  getRun: (runId: string) =>
    api.get<Run>(`/api/runs/${runId}`).then((r) => r.data),

  getRunStages: (runId: string) =>
    api.get<StageResult[]>(`/api/runs/${runId}/stages`).then((r) => r.data),

  getRunArtifacts: (runId: string) =>
    api.get<Artifact[]>(`/api/runs/${runId}/artifacts`).then((r) => r.data),

  getRunCheckpoints: (runId: string) =>
    api.get<Checkpoint[]>(`/api/runs/${runId}/checkpoints`).then((r) => r.data),

  getCodeReviewFiles: (runId: string) =>
    api.get<CodeReviewFilesPayload>(`/api/runs/${runId}/code-review-files`).then((r) => r.data),

  getTestProgress: (runId: string) =>
    api.get<TestProgress>(`/api/runs/${runId}/test-progress`).then((r) => r.data),

  pauseRun: (runId: string) =>
    api.post(`/api/runs/${runId}/pause`).then((r) => r.data),

  resumeRun: (runId: string) =>
    api.post(`/api/runs/${runId}/resume`).then((r) => r.data),

  terminateRun: (runId: string) =>
    api.post(`/api/runs/${runId}/terminate`).then((r) => r.data),

  submitClarification: (runId: string, data: ClarificationSubmit) =>
    api.post(`/api/runs/${runId}/clarifications`, data).then((r) => r.data),

  getClarification: (runId: string) =>
    api.get<ClarificationPayload>(`/api/runs/${runId}/clarification`).then((r) => r.data),

  // Checkpoints
  getCheckpoint: (id: string) =>
    api.get<Checkpoint>(`/api/checkpoints/${id}`).then((r) => r.data),

  approveCheckpoint: (id: string, decided_by: string, reason: string) =>
    api.post<Checkpoint>(`/api/checkpoints/${id}/approve`, { decided_by, reason }).then((r) => r.data),

  rejectCheckpoint: (id: string, decided_by: string, reason: string, retry_stage_key: string) =>
    api.post<Checkpoint>(`/api/checkpoints/${id}/reject`, { decided_by, reason, retry_stage_key }).then((r) => r.data),

  // Artifacts
  getArtifactContent: async (artifact: Artifact): Promise<string> => {
    try {
      const r = await api.get<string>(`/api/artifacts/${artifact.id}/content`)
      return r.data
    } catch {
      if (import.meta.env.DEV && artifact.file_path) {
        try {
          const r = await axios.get<string>(`/@fs${artifact.file_path}`, { responseType: 'text' })
          return r.data
        } catch {
          // The current backend does not expose artifact file contents.
        }
      }
      return [
        `# ${artifact.filename}`,
        '',
        '无法读取 artifact 内容，前端已保留产物元信息。',
        '',
        `本地文件路径：${artifact.file_path || '未提供'}`,
        `内容类型：${artifact.content_type}`,
        `文件大小：${artifact.size_bytes} bytes`,
      ].join('\n')
    }
  },

  // Meta
  getMeta: () => api.get('/api/meta').then((r) => r.data),

  getWorkspace: async () => {
    try {
      return await api.get<{ path: string }>('/api/workspace').then((r) => r.data)
    } catch {
      return { path: DEFAULT_REPO_PATH }
    }
  },

  checkRepo: (path: string) =>
    api.get<RepoCheck>('/api/repo-check', { params: { path } }).then((r) => r.data),

  getSourceApplicationStatus: (runId: string) =>
    api.get<SourceApplicationStatus>(`/api/runs/${runId}/source-application`).then((r) => r.data),

  rollbackRun: (runId: string) =>
    api.post<RollbackResult>(`/api/runs/${runId}/rollback`).then((r) => r.data),
}
