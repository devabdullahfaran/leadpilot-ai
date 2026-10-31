// App-level behaviour that never reaches the database: runs with or without PostgREST.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { Bindings } from '../../src/env'
import { resetRateLimits } from '../../src/middleware/rate-limit'
import { buildEnv, createFakeExternal } from './harness'

// Nothing listens here; any accidental database call fails loudly instead of hitting a real server.
const UNUSED_REST_URL = 'http://127.0.0.1:9'

// Response bodies are asserted structurally below.
const json = (res: Response): Promise<any> => res.json()

let env: Bindings
const fake = createFakeExternal()
const app = createApp({ externalFetch: fake.fetch })

beforeAll(async () => {
  env = await buildEnv(UNUSED_REST_URL)
})

beforeEach(() => resetRateLimits())

describe('app without database', () => {
  it('GET /api/v1/health returns status, version and environment', async () => {
    const res = await app.request('/api/v1/health', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
    const body = await json(res)
    expect(body).toMatchObject({ status: 'ok', version: expect.any(String), environment: 'test' })
    expect(Number.isNaN(Date.parse(body.time))).toBe(false)
  })

  it('CORS preflight allows configured origins only', async () => {
    const preflight = (origin: string, path = '/api/v1/leads') =>
      app.request(path, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } }, env)

    const allowed = await preflight('http://localhost:5173')
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(allowed.headers.get('Access-Control-Allow-Headers') ?? '').toContain('X-Workspace-Id')

    const denied = await preflight('https://evil.example')
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull()

    // The intake webhook accepts any origin (the intake key is the credential).
    const intake = await preflight('https://customer-site.example', '/api/v1/intake/00000000-0000-4000-8000-000000000000')
    expect(intake.headers.get('Access-Control-Allow-Origin')).toBe('https://customer-site.example')
  })

  it('protected routes return 401 JSON without a token', async () => {
    for (const path of ['/api/v1/me', '/api/v1/leads', '/api/v1/dashboard/summary', '/api/v1/workflows/overview']) {
      const res = await app.request(path, {}, env)
      expect(res.status, path).toBe(401)
      const body = await json(res)
      expect(body.error).toMatchObject({ code: 'unauthorized', requestId: expect.any(String) })
    }
  })

  it('rejects a malformed bearer token with 401', async () => {
    const res = await app.request('/api/v1/leads', { headers: { Authorization: 'Bearer not-a-jwt' } }, env)
    expect(res.status).toBe(401)
    expect((await json(res)).error.code).toBe('unauthorized')
  })

  it('unknown routes return the 404 error shape', async () => {
    const res = await app.request('/api/v1/does-not-exist', {}, env)
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: { code: 'not_found', message: 'Route not found', requestId: expect.any(String) } })
  })

  it('bodies over 64 KB return 413 payload_too_large', async () => {
    const body = JSON.stringify({ message: 'x'.repeat(70 * 1024) })
    const res = await app.request(
      '/api/v1/leads',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) }, body },
      env,
    )
    expect(res.status).toBe(413)
    expect((await json(res)).error.code).toBe('payload_too_large')
  })

  it('invalid configuration returns a 500 error response without leaking details', async () => {
    const broken = { ...env, SUPABASE_URL: 'not a url' }
    const res = await app.request('/api/v1/health', {}, broken)
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body.error).toMatchObject({ code: 'internal_error', requestId: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain(env.SUPABASE_SECRET_KEY)
  })

  it('makes no external calls', () => {
    expect(fake.calls).toEqual([])
  })
})
