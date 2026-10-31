import { isApiErrorBody, type ApiErrorCode } from '@leadpilot/shared'
import { env } from './env'
import { getStoredWorkspaceId } from './storage'
import { supabase } from './supabase'

/** `user` = signed-in API (`/api/v1`), `demo` = public read-only preview (`/api/v1/demo`). */
export type DataMode = 'user' | 'demo'

/** Server error codes plus two client-side ones for failures that never produced an API response. */
export type ClientErrorCode = ApiErrorCode | 'network_error' | 'invalid_response'

export interface FieldError {
  path: string
  message: string
}

export class ApiClientError extends Error {
  readonly status: number
  readonly code: ClientErrorCode
  readonly details: unknown
  readonly requestId: string | null
  /** Seconds from the `Retry-After` header (429 responses), when present. */
  readonly retryAfter: number | null

  constructor(init: {
    status: number
    code: ClientErrorCode
    message: string
    details?: unknown
    requestId?: string | null
    retryAfter?: number | null
  }) {
    super(init.message)
    this.name = 'ApiClientError'
    this.status = init.status
    this.code = init.code
    this.details = init.details
    this.requestId = init.requestId ?? null
    this.retryAfter = init.retryAfter ?? null
  }

  /** Network failures and 5xx responses are worth retrying; 4xx are not. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500
  }

  /** `validation_error` details as `{ path: message }` (first message per field). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    if (this.code !== 'validation_error' || !Array.isArray(this.details)) return out
    for (const item of this.details as unknown[]) {
      if (typeof item !== 'object' || item === null) continue
      const { path, message } = item as Partial<FieldError>
      if (typeof path === 'string' && typeof message === 'string' && !(path in out)) out[path] = message
    }
    return out
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'validation_error',
  429: 'rate_limited',
}

function fallbackCode(status: number): ApiErrorCode {
  return STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'bad_request')
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - Date.now()) / 1000))
}

/** Turns a non-2xx response into an ApiClientError, preferring the API's `ApiErrorBody`. */
export async function parseErrorResponse(res: Response): Promise<ApiClientError> {
  const headerRequestId = res.headers.get('X-Request-Id')
  const retryAfter = parseRetryAfter(res.headers.get('Retry-After'))
  let body: unknown = null
  try {
    const text = await res.text()
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (isApiErrorBody(body)) {
    return new ApiClientError({
      status: res.status,
      code: body.error.code,
      message: body.error.message,
      details: body.error.details,
      requestId: body.error.requestId ?? headerRequestId,
      retryAfter,
    })
  }
  return new ApiClientError({
    status: res.status,
    code: fallbackCode(res.status),
    message: `Request failed with status ${res.status}${res.statusText ? ` (${res.statusText})` : ''}.`,
    requestId: headerRequestId,
    retryAfter,
  })
}

// ---------------------------------------------------------------------------
// Active workspace
// ---------------------------------------------------------------------------

let sessionWorkspaceIds: string[] | null = null

/** Called by the session layer whenever `/me` loads (or with `null` on sign-out). */
export function setSessionWorkspaces(ids: string[] | null): void {
  sessionWorkspaceIds = ids
}

/**
 * The workspace to send as `X-Workspace-Id`: the stored choice when the session confirms membership,
 * otherwise the first membership. `null` until the session is known (the API then uses its default).
 */
export function resolveWorkspaceId(): string | null {
  if (!sessionWorkspaceIds || sessionWorkspaceIds.length === 0) return null
  const stored = getStoredWorkspaceId()
  return stored && sessionWorkspaceIds.includes(stored) ? stored : sessionWorkspaceIds[0]
}

// ---------------------------------------------------------------------------
// Expired sessions
// ---------------------------------------------------------------------------

let handlingUnauthorized = false

async function defaultUnauthorizedHandler(): Promise<void> {
  if (handlingUnauthorized) return
  handlingUnauthorized = true
  try {
    await supabase?.auth.signOut({ scope: 'local' })
  } catch {
    // The session is already unusable; continue to the login page.
  }
  const next = `${window.location.pathname}${window.location.search}`
  const params = new URLSearchParams({ expired: '1' })
  if (!next.startsWith('/login')) params.set('next', next)
  window.location.assign(`/login?${params.toString()}`)
}

let unauthorizedHandler: () => void | Promise<void> = defaultUnauthorizedHandler

/** Test hook: replace what happens on a 401 in user mode. Pass `null` to restore the default. */
export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null): void {
  unauthorizedHandler = handler ?? defaultUnauthorizedHandler
  handlingUnauthorized = false
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  mode?: DataMode
  method?: HttpMethod
  query?: object
  body?: unknown
  /** Explicit workspace. `undefined` resolves it from storage + session; `null` sends no header. */
  workspaceId?: string | null
  signal?: AbortSignal
}

export function apiBaseUrl(mode: DataMode): string {
  return `${env.apiUrl}/api/v1${mode === 'demo' ? '/demo' : ''}`
}

export function buildApiUrl(path: string, mode: DataMode, query?: object): string {
  const url = `${apiBaseUrl(mode)}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query as Record<string, QueryValue>)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const mode = options.mode ?? 'user'
  const method = options.method ?? 'GET'
  const headers = new Headers({ Accept: 'application/json' })

  if (mode === 'user') {
    const token = await accessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const workspaceId = options.workspaceId === undefined ? resolveWorkspaceId() : options.workspaceId
    if (workspaceId) headers.set('X-Workspace-Id', workspaceId)
  }

  let body: string | undefined
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }

  let res: Response
  try {
    res = await fetch(buildApiUrl(path, mode, options.query), { method, headers, body, signal: options.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiClientError({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the LeadPilot API. Check your connection and try again.',
    })
  }

  if (!res.ok) {
    const error = await parseErrorResponse(res)
    if (res.status === 401 && mode === 'user') void unauthorizedHandler()
    throw error
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiClientError({
      status: res.status,
      code: 'invalid_response',
      message: 'The API returned a response that could not be read.',
      requestId: res.headers.get('X-Request-Id'),
    })
  }
}

/** Human-readable message for any thrown value (toasts, inline alerts). */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}
