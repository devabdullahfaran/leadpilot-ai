import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { AnalyticsResponse, DashboardSummary } from '@leadpilot/shared'
import { queryKeys } from './keys'
import { scopedRequest, useApiScope } from './scope'

/** `GET /dashboard/summary` */
export function useDashboardSummary() {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.dashboard(scope),
    enabled: scope.ready,
    queryFn: ({ signal }) => scopedRequest<DashboardSummary>(scope, '/dashboard/summary', { signal }),
  })
}

/** `GET /analytics?days=` (7–365). Keeps the previous range on screen while a new one loads. */
export function useAnalytics(days = 30) {
  const scope = useApiScope()
  return useQuery({
    queryKey: queryKeys.analytics(scope, days),
    enabled: scope.ready,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => scopedRequest<AnalyticsResponse>(scope, '/analytics', { query: { days }, signal }),
  })
}
