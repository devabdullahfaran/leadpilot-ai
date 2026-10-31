import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Paginated, QualifyResult, WorkflowExecution, WorkflowOverviewItem } from '@leadpilot/shared'
import { queryKeys } from './keys'
import { invalidateAll, useScopedMutation } from './mutation'
import { scopedRequest, useApiScope, type ApiScope } from './scope'
import type { ExecutionDetail, ExecutionListParams } from './types'

const executionPath = (id: string) => `/workflows/executions/${encodeURIComponent(id)}`

/** `GET /workflows/overview` → one row per workflow key × engine. */
export function useWorkflowOverview() {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.workflows.overview(scope),
    enabled: scope.ready,
    queryFn: async ({ signal }) =>
      (await scopedRequest<{ data: WorkflowOverviewItem[] }>(scope, '/workflows/overview', { signal })).data,
  })
}

/** `GET /workflows/executions` — paginated, newest first. */
export function useExecutions(params: ExecutionListParams = {}) {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.workflows.executionList(scope, params),
    enabled: scope.ready,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      scopedRequest<Paginated<WorkflowExecution>>(scope, '/workflows/executions', { query: params, signal }),
  })
}

/** `GET /workflows/executions/:id` — includes notification events. */
export function useExecution(id: string | undefined) {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.workflows.execution(scope, id ?? ''),
    enabled: scope.ready && Boolean(id),
    queryFn: ({ signal }) => scopedRequest<ExecutionDetail>(scope, executionPath(id!), { signal }),
  })
}

function retryKeys(scope: ApiScope, leadId: string | null | undefined) {
  return [
    queryKeys.workflows.all(scope),
    queryKeys.integrations.all(scope),
    queryKeys.dashboard(scope),
    queryKeys.analyticsAll(scope),
    ...(leadId ? [queryKeys.leads.detail(scope, leadId)] : []),
    queryKeys.leads.lists(scope),
  ]
}

/**
 * `POST /workflows/executions/:id/retry` — Worker executions in `failed`/`partial` only.
 * Pass `leadId` when known so the lead's detail view refreshes too.
 */
export function useRetryExecution() {
  return useScopedMutation(
    ({ executionId }: { executionId: string; leadId?: string | null }, scope) =>
      scopedRequest<QualifyResult>(scope, `${executionPath(executionId)}/retry`, { method: 'POST' }),
    {
      onSuccess: ({ queryClient, scope, data, vars }) => {
        queryClient.setQueryData(queryKeys.leads.detail(scope, data.lead.id), data.lead)
        return invalidateAll(queryClient, retryKeys(scope, vars.leadId ?? data.lead.id))
      },
      invalidateOnError: (vars, scope) => retryKeys(scope, vars.leadId),
    },
  )
}
