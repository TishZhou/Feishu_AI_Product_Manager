import axios from 'axios'
import type { Pipeline, PipelineCreate, Run, StageResult, Artifact, Checkpoint } from '../types/api'

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
      return `# ${artifact.filename}\n\nContent preview not available.`
    }
  },

  // Meta
  getMeta: () => api.get('/api/meta').then((r) => r.data),

  getWorkspace: () =>
    api.get<{ path: string }>('/api/workspace').then((r) => r.data),
}
