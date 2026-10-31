/** Stable machine-readable error codes. The web app branches on these, never on messages. */
export const API_ERROR_CODES = [
  'bad_request',
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'duplicate_lead',
  'read_only',
  'rate_limited',
  'payload_too_large',
  'ai_disabled',
  'ai_not_configured',
  'ai_quota_exceeded',
  'ai_unavailable',
  'ai_invalid_response',
  'integration_not_configured',
  'integration_failed',
  'internal_error',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
    requestId?: string
  }
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const err = (value as { error: unknown }).error
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err
}
