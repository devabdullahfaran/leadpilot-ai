import { useQuery } from '@tanstack/react-query'
import type { AiUsageEvent, IntegrationsStatus, SlackSettingsInput } from '@leadpilot/shared'
import { queryKeys } from './keys'
import { invalidateAll, useScopedMutation } from './mutation'
import { scopedRequest, useApiScope } from './scope'
import type { IntakeKeyResult } from './types'

/** `GET /integrations` — configuration flags, masked hints and usage counters (never secrets). */
export function useIntegrations() {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.integrations.status(scope),
    enabled: scope.ready,
    queryFn: ({ signal }) => scopedRequest<IntegrationsStatus>(scope, '/integrations', { signal }),
  })
}

/** `GET /integrations/ai-usage` → last 50 AI calls. */
export function useAiUsage() {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.integrations.aiUsage(scope),
    enabled: scope.ready,
    queryFn: async ({ signal }) =>
      (await scopedRequest<{ data: AiUsageEvent[] }>(scope, '/integrations/ai-usage', { signal })).data,
  })
}

/** `PUT /integrations/slack` (admin). `webhookUrl` is required on first setup only. */
export function useSaveSlack() {
  return useScopedMutation(
    (body: SlackSettingsInput, scope) =>
      scopedRequest<IntegrationsStatus['slack']>(scope, '/integrations/slack', { method: 'PUT', body }),
    { onSuccess: ({ queryClient, scope }) => invalidateAll(queryClient, [queryKeys.integrations.all(scope)]) },
  )
}

/** `DELETE /integrations/slack` (admin). */
export function useDeleteSlack() {
  return useScopedMutation(
    (_: void, scope) => scopedRequest<void>(scope, '/integrations/slack', { method: 'DELETE' }),
    { onSuccess: ({ queryClient, scope }) => invalidateAll(queryClient, [queryKeys.integrations.all(scope)]) },
  )
}

/** `POST /integrations/slack/test` (admin) — sends a real message and records an execution. */
export function useTestSlack() {
  return useScopedMutation(
    (_: void, scope) => scopedRequest<{ status: 'sent' }>(scope, '/integrations/slack/test', { method: 'POST' }),
    {
      onSuccess: ({ queryClient, scope }) =>
        invalidateAll(queryClient, [queryKeys.integrations.all(scope), queryKeys.workflows.all(scope)]),
      invalidateOnError: (_, scope) => [queryKeys.integrations.all(scope), queryKeys.workflows.all(scope)],
    },
  )
}

/** `POST /integrations/intake-key` (admin) — the returned key is shown once; never cache it. */
export function useRotateIntakeKey() {
  return useScopedMutation(
    (_: void, scope) => scopedRequest<IntakeKeyResult>(scope, '/integrations/intake-key', { method: 'POST' }),
    { onSuccess: ({ queryClient, scope }) => invalidateAll(queryClient, [queryKeys.integrations.status(scope)]) },
  )
}
