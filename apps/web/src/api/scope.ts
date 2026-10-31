import { useDataMode } from '@/app/data-mode'
import { useWorkspace } from '@/app/workspace'
import { ApiClientError, apiRequest, type DataMode, type HttpMethod } from '@/lib/api-client'

export interface ApiScope {
  mode: DataMode
  /** Active workspace in user mode; null in preview mode (the API pins the sample workspace). */
  workspaceId: string | null
  /** False while user mode is still resolving its workspace; queries wait for it. */
  ready: boolean
}

export function useApiScope(): ApiScope {
  const { mode } = useDataMode()
  const { workspace } = useWorkspace()
  if (mode === 'demo') return { mode, workspaceId: null, ready: true }
  return { mode, workspaceId: workspace?.id ?? null, ready: Boolean(workspace) }
}

export function scopedRequest<T>(
  scope: ApiScope,
  path: string,
  init: { method?: HttpMethod; query?: object; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  return apiRequest<T>(path, { ...init, mode: scope.mode, workspaceId: scope.mode === 'user' ? scope.workspaceId : null })
}

/** Mutations never reach the network in preview mode; the UI should already have disabled the control. */
export function assertWritable(scope: ApiScope): void {
  if (scope.mode === 'demo') {
    throw new ApiClientError({
      status: 403,
      code: 'read_only',
      message: 'The portfolio preview is read-only. Sign in to make changes.',
    })
  }
}
