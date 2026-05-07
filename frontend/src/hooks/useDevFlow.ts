import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import type { PipelineCreate, GitPublishOptions } from '../types/api'

export function useWorkspace() {
  return useQuery({
    queryKey: ['workspace'],
    queryFn: () => apiClient.getWorkspace(),
    staleTime: Infinity,
    retry: false,
  })
}

export function useCreatePipeline() {
  return useMutation({
    mutationFn: (data: PipelineCreate) => apiClient.createPipeline(data),
  })
}

export function useCreateRun() {
  return useMutation({
    mutationFn: (pipelineId: string) => apiClient.createRun(pipelineId),
  })
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => apiClient.getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Poll while the run is alive. Terminal statuses stop polling.
      // We must keep polling through waiting_for_approval / waiting_for_clarification
      // so the checkpoint modal pops up when the orchestrator transitions back to
      // running and then to waiting_for_approval after a clarification round.
      const terminal = ['completed', 'failed', 'terminated']
      if (status && terminal.includes(status)) return false
      return 2000
    },
  })
}

export function useRunStages(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId, 'stages'],
    queryFn: () => apiClient.getRunStages(runId!),
    enabled: !!runId,
    refetchInterval: () => {
      return 2000
    },
  })
}

export function useRunArtifacts(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId, 'artifacts'],
    queryFn: () => apiClient.getRunArtifacts(runId!),
    enabled: !!runId,
    refetchInterval: 2000,
  })
}

export function useRunCheckpoints(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId, 'checkpoints'],
    queryFn: () => apiClient.getRunCheckpoints(runId!),
    enabled: !!runId,
    refetchInterval: 2000,
  })
}

export function useRunActions() {
  const queryClient = useQueryClient()

  const pause = useMutation({
    mutationFn: (runId: string) => apiClient.pauseRun(runId),
    onSuccess: (_, runId) => queryClient.invalidateQueries({ queryKey: ['run', runId] }),
  })

  const resume = useMutation({
    mutationFn: (runId: string) => apiClient.resumeRun(runId),
    onSuccess: (_, runId) => queryClient.invalidateQueries({ queryKey: ['run', runId] }),
  })

  const terminate = useMutation({
    mutationFn: (runId: string) => apiClient.terminateRun(runId),
    onSuccess: (_, runId) => queryClient.invalidateQueries({ queryKey: ['run', runId] }),
  })

  const retryStage = useMutation({
    mutationFn: ({ runId, stageKey }: { runId: string; stageKey: string }) =>
      apiClient.retryRunFromStage(runId, stageKey),
    onSuccess: (_, { runId }) => {
      queryClient.invalidateQueries({ queryKey: ['run', runId] })
    },
  })

  return { pause, resume, terminate, retryStage }
}

export function useRunTokenUsage(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId, 'token-usage'],
    queryFn: () => apiClient.getTokenUsage(runId!),
    enabled: !!runId,
    refetchInterval: 2000,
  })
}

export function useSourceApplication(runId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['run', runId, 'source-application'],
    queryFn: () => apiClient.getSourceApplicationStatus(runId!),
    enabled: enabled && !!runId,
    staleTime: 5_000,
    retry: false,
  })
}

export function useRollbackRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => apiClient.rollbackRun(runId),
    onSuccess: (_, runId) => {
      queryClient.invalidateQueries({ queryKey: ['run', runId, 'source-application'] })
    },
  })
}

export function useGitStatus(runId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['run', runId, 'git-status'],
    queryFn: () => apiClient.getGitStatus(runId!),
    enabled: enabled && !!runId,
    staleTime: 10_000,
    retry: false,
  })
}

export function useGitPublish() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, options }: { runId: string; options: GitPublishOptions }) =>
      apiClient.publishRunGit(runId, options),
    onSuccess: (_, { runId }) => {
      queryClient.invalidateQueries({ queryKey: ['run', runId, 'git-status'] })
    },
  })
}

export function useTestProgress(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId, 'test-progress'],
    queryFn: () => apiClient.getTestProgress(runId!),
    enabled: !!runId,
    refetchInterval: 1000,
  })
}

export function useCheckpointActions() {
  const queryClient = useQueryClient()

  const approve = useMutation({
    mutationFn: ({
      id, decided_by, reason, next_provider, next_model,
    }: {
      id: string; decided_by: string; reason: string
      next_provider?: string; next_model?: string
    }) =>
      apiClient.approveCheckpoint(id, decided_by, reason, next_provider, next_model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run'] })
    },
  })

  const reject = useMutation({
    mutationFn: ({
      id, decided_by, reason, retry_stage_key, next_provider, next_model,
    }: {
      id: string
      decided_by: string
      reason: string
      retry_stage_key: string
      next_provider?: string
      next_model?: string
    }) => apiClient.rejectCheckpoint(id, decided_by, reason, retry_stage_key, next_provider, next_model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run'] })
    },
  })

  return { approve, reject }
}
