import { useQuery } from '@tanstack/react-query'
import type { AiSettings, MemberSummary } from '@leadpilot/shared'
import { queryKeys } from './keys'
import { invalidateAll, useScopedMutation } from './mutation'
import { scopedRequest, useApiScope } from './scope'
import type { SampleDataResult } from './types'

/** `GET /settings/ai` — defaults when never saved. */
export function useAiSettings() {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.settings.ai(scope),
    enabled: scope.ready,
    queryFn: ({ signal }) => scopedRequest<AiSettings>(scope, '/settings/ai', { signal }),
  })
}

/** `PUT /settings/ai` (admin). Validate with `aiSettingsSchema` before sending. */
export function useSaveAiSettings() {
  return useScopedMutation(
    (body: AiSettings, scope) => scopedRequest<AiSettings>(scope, '/settings/ai', { method: 'PUT', body }),
    {
      onSuccess: ({ queryClient, scope, data }) => {
        queryClient.setQueryData(queryKeys.settings.ai(scope), data)
        return invalidateAll(queryClient, [queryKeys.integrations.all(scope)])
      },
    },
  )
}

/** `GET /settings/members` (always empty in the preview). */
export function useMembers() {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.settings.members(scope),
    enabled: scope.ready,
    queryFn: async ({ signal }) =>
      (await scopedRequest<{ data: MemberSummary[] }>(scope, '/settings/members', { signal })).data,
  })
}

/** `POST /settings/sample-data` (admin) — loads synthetic `is_sample` records. Refreshes the whole workspace. */
export function useLoadSampleData() {
  return useScopedMutation(
    (_: void, scope) => scopedRequest<SampleDataResult>(scope, '/settings/sample-data', { method: 'POST' }),
    { onSuccess: ({ queryClient, scope }) => invalidateAll(queryClient, [queryKeys.scope(scope)]) },
  )
}

/** `DELETE /settings/sample-data` (admin) — removes every sample record. */
export function useClearSampleData() {
  return useScopedMutation(
    (_: void, scope) => scopedRequest<SampleDataResult>(scope, '/settings/sample-data', { method: 'DELETE' }),
    { onSuccess: ({ queryClient, scope }) => invalidateAll(queryClient, [queryKeys.scope(scope)]) },
  )
}
