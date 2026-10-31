import type { ApiErrorBody, ApiErrorCode } from '@leadpilot/shared'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import type { AppEnv } from '../types'
import { log } from './logger'

export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new ApiError(403, 'forbidden', message)
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`)
export const conflict = (message: string, details?: unknown) => new ApiError(409, 'conflict', message, details)
export const readOnly = () =>
  new ApiError(403, 'read_only', 'The portfolio preview is read-only. Sign in to modify data.')

/** Shape of errors returned by postgrest-js. */
export interface PostgrestErrorLike {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
}

/**
 * Converts a PostgREST/PostgreSQL error into an ApiError. Database messages are logged but not
 * returned verbatim for unexpected errors, to avoid leaking schema details.
 */
export function fromPostgrest(error: PostgrestErrorLike, context: string): ApiError {
  switch (error.code) {
    case 'PGRST116':
      return notFound()
    case '23505':
      return conflict('A record with the same unique value already exists')
    case '23503':
      return new ApiError(422, 'validation_error', 'A referenced record does not exist')
    case '23514':
    case '22P02':
    case '22001':
      return new ApiError(422, 'validation_error', error.message)
    case '42501':
      return forbidden()
    default:
      log('error', 'database_error', { context, code: error.code, message: error.message })
      return new ApiError(500, 'internal_error', 'A database error occurred')
  }
}

/** Throws when a postgrest-js result contains an error; otherwise returns its data. */
export function unwrap<T>(result: { data: T; error: PostgrestErrorLike | null }, context: string): T {
  if (result.error) throw fromPostgrest(result.error, context)
  return result.data
}

export function errorResponse(c: Context<AppEnv>, err: unknown) {
  const requestId = c.get('requestId')
  if (err instanceof ApiError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, requestId } }
    if (err.details !== undefined) body.error.details = err.details
    return c.json(body, err.status)
  }
  if (err instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId,
      },
    }
    return c.json(body, 422)
  }
  log('error', 'unhandled_error', {
    requestId,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
  })
  const body: ApiErrorBody = { error: { code: 'internal_error', message: 'Unexpected server error', requestId } }
  return c.json(body, 500)
}
