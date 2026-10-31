import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiClientError,
  apiRequest,
  buildApiUrl,
  parseErrorResponse,
  resolveWorkspaceId,
  setSessionWorkspaces,
  setUnauthorizedHandler,
} from './api-client'
import { setStoredWorkspaceId } from './storage'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setSessionWorkspaces(null)
  setStoredWorkspaceId(null)
  setUnauthorizedHandler(null)
})

describe('parseErrorResponse', () => {
  it('parses an ApiErrorBody', async () => {
    const res = jsonResponse(
      { error: { code: 'duplicate_lead', message: 'A lead with this email exists', details: { existingLeadId: 'l1' }, requestId: 'req-1' } },
      { status: 409 },
    )
    const error = await parseErrorResponse(res)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({
      status: 409,
      code: 'duplicate_lead',
      message: 'A lead with this email exists',
      details: { existingLeadId: 'l1' },
      requestId: 'req-1',
    })
  })

  it('falls back to the X-Request-Id header and a status-derived code for non-JSON bodies', async () => {
    const res = new Response('<html>Bad gateway</html>', { status: 502, headers: { 'X-Request-Id': 'req-2' } })
    const error = await parseErrorResponse(res)
    expect(error.code).toBe('internal_error')
    expect(error.requestId).toBe('req-2')
    expect(error.isRetryable).toBe(true)
  })

  it('reads Retry-After and validation field errors', async () => {
    const rateLimited = await parseErrorResponse(
      jsonResponse({ error: { code: 'ai_quota_exceeded', message: 'Daily AI limit reached' } }, { status: 429, headers: { 'Retry-After': '30' } }),
    )
    expect(rateLimited.retryAfter).toBe(30)
    expect(rateLimited.isRetryable).toBe(false)

    const invalid = await parseErrorResponse(
      jsonResponse(
        {
          error: {
            code: 'validation_error',
            message: 'Invalid input',
            details: [
              { path: 'email', message: 'Invalid email' },
              { path: 'email', message: 'Second message ignored' },
              { path: 'name', message: 'Required' },
            ],
          },
        },
        { status: 422 },
      ),
    )
    expect(invalid.fieldErrors).toEqual({ email: 'Invalid email', name: 'Required' })
  })
})

describe('apiRequest', () => {
  it('builds user and demo URLs, skipping empty query values', () => {
    expect(buildApiUrl('/leads', 'user', { q: 'acme', status: undefined, page: 2, owner: '' })).toBe(
      'http://localhost:8787/api/v1/leads?q=acme&page=2',
    )
    expect(buildApiUrl('/dashboard/summary', 'demo')).toBe('http://localhost:8787/api/v1/demo/dashboard/summary')
  })

  it('returns parsed JSON and sends the workspace header in user mode', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'lead-1' }))
    const data = await apiRequest<{ id: string }>('/leads/lead-1', { workspaceId: 'ws-1' })
    expect(data).toEqual({ id: 'lead-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8787/api/v1/leads/lead-1')
    expect(new Headers(init?.headers).get('X-Workspace-Id')).toBe('ws-1')
  })

  it('never sends workspace or auth headers in demo mode', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await apiRequest('/leads', { mode: 'demo', workspaceId: 'ws-1' })
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('X-Workspace-Id')).toBeNull()
    expect(headers.get('Authorization')).toBeNull()
  })

  it('serializes JSON bodies', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ lead: { id: 'x' } }, { status: 201 }))
    await apiRequest('/leads', { method: 'POST', body: { name: 'Ada' }, workspaceId: null })
    const init = fetchMock.mock.calls[0][1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"name":"Ada"}')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
  })

  it('handles 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(apiRequest('/leads/1', { method: 'DELETE', workspaceId: null })).resolves.toBeUndefined()
  })

  it('throws ApiClientError for API errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'not_found', message: 'Lead not found', requestId: 'req-9' } }, { status: 404 }),
    )
    const error = await apiRequest('/leads/missing', { workspaceId: null }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({ status: 404, code: 'not_found', requestId: 'req-9' })
  })

  it('maps fetch failures to a retryable network_error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await apiRequest('/leads', { workspaceId: null }).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 0, code: 'network_error', isRetryable: true })
  })

  it('calls the unauthorized handler on 401 in user mode only', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: 'Expired' } }, { status: 401 }))

    await expect(apiRequest('/leads', { mode: 'demo' })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(handler).not.toHaveBeenCalled()

    await expect(apiRequest('/leads', { workspaceId: null })).rejects.toMatchObject({ status: 401 })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('resolveWorkspaceId', () => {
  it('uses the stored workspace only when the session confirms membership', () => {
    expect(resolveWorkspaceId()).toBeNull()
    setSessionWorkspaces(['ws-a', 'ws-b'])
    expect(resolveWorkspaceId()).toBe('ws-a')
    setStoredWorkspaceId('ws-b')
    expect(resolveWorkspaceId()).toBe('ws-b')
    setStoredWorkspaceId('ws-stale')
    expect(resolveWorkspaceId()).toBe('ws-a')
  })
})
