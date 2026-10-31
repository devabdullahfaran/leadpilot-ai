import { describe, expect, it } from 'vitest'
import { ApiClientError } from '@/lib/api-client'
import { shouldRetry } from './query-client'

const err = (status: number) => new ApiClientError({ status, code: status === 0 ? 'network_error' : 'bad_request', message: 'x' })

describe('shouldRetry', () => {
  it('retries network errors and 5xx a limited number of times', () => {
    expect(shouldRetry(0, err(0))).toBe(true)
    expect(shouldRetry(1, err(503))).toBe(true)
    expect(shouldRetry(2, err(503))).toBe(false)
  })

  it('never retries 4xx or unknown errors', () => {
    expect(shouldRetry(0, err(404))).toBe(false)
    expect(shouldRetry(0, err(429))).toBe(false)
    expect(shouldRetry(0, new Error('boom'))).toBe(false)
  })
})
