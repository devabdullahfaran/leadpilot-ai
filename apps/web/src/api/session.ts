import { useQuery } from '@tanstack/react-query'
import type { SessionInfo, WorkspaceSummary } from '@leadpilot/shared'
import { useAuth } from '@/auth/auth-context'
import { apiRequest, setSessionWorkspaces } from '@/lib/api-client'
import { queryKeys } from './keys'
import { useScopedMutation, invalidateAll } from './mutation'
import type { HealthStatus } from './types'

/** `GET /me` — the signed-in user and their workspaces. Disabled when signed out. */
export function useSession() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.session(user?.id ?? null),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      // No X-Workspace-Id: the API would reject a stale stored id with 403 before we can validate it.
      const session = await apiRequest<SessionInfo>('/me', { workspaceId: null, signal })
      setSessionWorkspaces(session.workspaces.map((w) => w.id))
      return session
    },
  })
}

/** `GET /health` — public liveness/version info. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    staleTime: 60_000,
    queryFn: ({ signal }) => apiRequest<HealthStatus>('/health', { workspaceId: null, signal }),
  })
}

/** `PATCH /me/profile` */
export function useUpdateProfile() {
  return useScopedMutation(
    (body: { fullName: string }, scope) =>
      apiRequest<{ fullName: string }>('/me/profile', { method: 'PATCH', body, mode: scope.mode, workspaceId: null }),
    {
      onSuccess: ({ queryClient, scope }) =>
        invalidateAll(queryClient, [['lp', 'session'], queryKeys.settings.members(scope)]),
    }
  )
}

/** `PATCH /settings/workspace` — renames the active workspace. */
export function useUpdateWorkspace() {
  return useScopedMutation(
    (body: { name: string }, scope) =>
      apiRequest<WorkspaceSummary>('/settings/workspace', {
        method: 'PATCH',
        body,
        mode: scope.mode,
        workspaceId: scope.workspaceId,
      }),
    {
      onSuccess: ({ queryClient }) => invalidateAll(queryClient, [['lp', 'session']]),
    }
  )
}
