import { QueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api-client'

const MAX_RETRIES = 2

/** Retry only failures that may succeed later: network errors and 5xx. 4xx answers are final. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRIES && isApiClientError(error) && error.isRetryable
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
