import { useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import type { ApiClientError } from '@/lib/api-client'
import { assertWritable, useApiScope, type ApiScope } from './scope'

interface SuccessContext<TData, TVars> {
  data: TData
  vars: TVars
  scope: ApiScope
  queryClient: QueryClient
}

interface ScopedMutationOptions<TData, TVars> {
  /** Cache updates + invalidations after success. Awaited, so `isPending` covers the refetch. */
  onSuccess?: (ctx: SuccessContext<TData, TVars>) => unknown
  /** Keys to refresh after a failure that still changed server state (e.g. a recorded failed AI run). */
  invalidateOnError?: (vars: TVars, scope: ApiScope) => QueryKey[]
}

export function invalidateAll(queryClient: QueryClient, keys: QueryKey[]): Promise<unknown> {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/** Workspace-scoped mutation that refuses to run in preview mode (no network call, `read_only` error). */
export function useScopedMutation<TData, TVars = void>(
  mutationFn: (vars: TVars, scope: ApiScope) => Promise<TData>,
  options: ScopedMutationOptions<TData, TVars> = {},
) {
  const scope = useApiScope()
  const queryClient = useQueryClient()
  return useMutation<TData, ApiClientError, TVars>({
    mutationFn: async (vars) => {
      assertWritable(scope)
      return mutationFn(vars, scope)
    },
    onSuccess: (data, vars) => options.onSuccess?.({ data, vars, scope, queryClient }),
    onError: (error, vars) => {
      if (!options.invalidateOnError || error.code === 'read_only') return
      void invalidateAll(queryClient, options.invalidateOnError(vars, scope))
    },
  })
}
