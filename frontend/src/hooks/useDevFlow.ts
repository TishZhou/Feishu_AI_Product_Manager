import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import type { PipelineCreate } from '../types/api'

export function useWorkspace() {
  return useQuery({
    queryKey: ['workspace'],
    queryFn: () => apiClient.getWorkspace(),
    staleTime: Infinity,
    retry: false,
  })
}

export function useRepoCheck(path: string, enabled: boolean) {
  return useQuery({
    queryKey: ['repo-check', path],
    queryFn: () => apiClient.checkRepo(path),
    enabled: enabled && path.length > 0,
    staleTime: 5_000,
    retry: false,
  })
}

export function useSourceApplicationStatus(runId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['source-application', runId],
    queryFn: () => apiClient.getSourceApplicationStatus(runId!),
    enabled: enabled && !!runId,
    refetchInterval: (query) => (query.state.data?.applied ? false : 4000),
    retry: false,
  })
}

export function useRollbackRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => apiClient.rollbackRun(runId),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: ['source-application', runId] })
    },
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

export function useExtractReferenceDocuments() {
  return useMutation({
    mutationFn: (files: File[]) => apiClient.extractReferenceDocuments(files),
  })
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => apiClient.getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ['created', 'running', 'waiting_for_clarification'].includes(status) ? 2000 : false
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

export function useCodeReviewFiles(runId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['run', runId, 'code-review-files'],
    queryFn: () => apiClient.getCodeReviewFiles(runId!),
    enabled: !!runId && enabled,
    refetchInterval: enabled ? 2000 : false,
  })
}

export function useTestProgress(runId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['run', runId, 'test-progress'],
    queryFn: () => apiClient.getTestProgress(runId!),
    enabled: !!runId && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return enabled && (!status || ['preparing', 'running'].includes(status)) ? 1000 : 2000
    },
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

  return { pause, resume, terminate }
}

export function useSubmitClarification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ runId, answers }: { runId: string; answers: string }) =>
      apiClient.submitClarification(runId, { answered_by: 'user', answers }),
    onSuccess: (_, { runId }) => {
      queryClient.invalidateQueries({ queryKey: ['run', runId] })
      queryClient.invalidateQueries({ queryKey: ['run', runId, 'stages'] })
      queryClient.invalidateQueries({ queryKey: ['run', runId, 'artifacts'] })
    },
  })
}

export function useClarification(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId, 'clarification'],
    queryFn: () => apiClient.getClarification(runId!),
    enabled: !!runId,
    refetchInterval: 2000,
  })
}

export function useCheckpointActions() {
  const queryClient = useQueryClient()

  const approve = useMutation({
    mutationFn: ({ id, decided_by, reason }: { id: string; decided_by: string; reason: string }) =>
      apiClient.approveCheckpoint(id, decided_by, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run'] })
    },
  })

  const reject = useMutation({
    mutationFn: ({
      id,
      decided_by,
      reason,
      retry_stage_key,
    }: {
      id: string
      decided_by: string
      reason: string
      retry_stage_key: string
    }) => apiClient.rejectCheckpoint(id, decided_by, reason, retry_stage_key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run'] })
    },
  })

  return { approve, reject }
}
