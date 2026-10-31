// Shared harness for API integration tests: Hono app → local PostgREST → local Postgres (RLS enforced).
// Third-party calls (Gemini, Slack) go through a fake externalFetch; nothing leaves the machine.
import { randomBytes } from 'node:crypto'
import type pg from 'pg'
import { createApp } from '../../src/app'
import type { Bindings } from '../../src/env'
import { resetDemoCache } from '../../src/middleware/demo'
import { resetRateLimits } from '../../src/middleware/rate-limit'
import { createAuthUser, createMember, type TestUser } from '../helpers/auth'
import { TEST_JWT_SECRET, TEST_SUPABASE_URL, signTestJwt } from '../helpers/jwt'
import { createPgClient } from '../helpers/pg'
import { postgrestMissingMessage, startPostgrest, type PostgrestServer } from '../helpers/postgrest'
import type { WorkspaceRole } from '@leadpilot/shared'

export const SLACK_WEBHOOK = 'https://hooks.slack.com/services/T0000TEST/B0000TEST/integrationtest'

/** A schema-valid Gemini structured output (category from the default settings, no criteria to reconcile). */
export const VALID_AI_OUTPUT = {
  score: 85,
  priority: 'high',
  category: 'software_development',
  summary: 'Wants a custom customer portal built this quarter.',
  reasoning: 'Clear project scope, stated budget and timeline, and the contact is a decision maker.',
  recommendedAction: 'Schedule a discovery call',
  confidence: 0.9,
  criteria: [],
}

export interface FakeExternal {
  fetch: typeof fetch
  gemini: 'valid' | 'invalid_json'
  slackStatus: number
  calls: { host: string; body: string }[]
  reset(): void
}

export function createFakeExternal(): FakeExternal {
  const fake: FakeExternal = {
    gemini: 'valid',
    slackStatus: 200,
    calls: [],
    reset() {
      fake.gemini = 'valid'
      fake.slackStatus = 200
      fake.calls = []
    },
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      fake.calls.push({ host: url.host, body: typeof init?.body === 'string' ? init.body : '' })
      if (url.host === 'generativelanguage.googleapis.com') {
        const text = fake.gemini === 'valid' ? JSON.stringify(VALID_AI_OUTPUT) : 'this is not json {'
        const body = {
          candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.host === 'hooks.slack.com') {
        return new Response(fake.slackStatus < 300 ? 'ok' : 'no_service', { status: fake.slackStatus })
      }
      throw new Error(`Unexpected external request in test: ${url.host}`)
    },
  }
  return fake
}

export async function buildEnv(restUrl: string, overrides: Partial<Bindings> = {}): Promise<Bindings> {
  return {
    ENVIRONMENT: 'test',
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_REST_URL: restUrl,
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
    SUPABASE_SECRET_KEY: await signTestJwt({ role: 'service_role' }),
    SUPABASE_PUBLISHABLE_KEY: await signTestJwt({ role: 'anon' }),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    GEMINI_API_KEY: 'test-key-not-real',
    GEMINI_TIMEOUT_MS: '5000',
    AI_ENABLED: 'true',
    AI_DAILY_LIMIT_GLOBAL: '100000',
    AI_DAILY_LIMIT_PER_WORKSPACE: '50',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ...overrides,
  }
}

export interface ApiResponse<T = any> {
  status: number
  body: T
  headers: Headers
}

export interface Harness {
  server: PostgrestServer
  db: pg.Client
  fake: FakeExternal
  env: Bindings
  app: ReturnType<typeof createApp>
  /** Sends a request; `token` null means no Authorization header. */
  call<T = any>(
    method: string,
    path: string,
    opts?: { token?: string | null; body?: unknown; headers?: Record<string, string>; env?: Bindings },
  ): Promise<ApiResponse<T>>
  /** Creates a user with a personal workspace (owner) and a valid access token. */
  user(prefix?: string): Promise<TestUser & { token: string }>
  /** Creates a user who is a member of `workspaceId` with `role`, plus a token. */
  member(workspaceId: string, role: WorkspaceRole): Promise<TestUser & { token: string }>
  envWith(overrides: Partial<Bindings>): Promise<Bindings>
  stop(): Promise<void>
}

/** Starts PostgREST and the app. Returns null when the PostgREST binary is unavailable. */
export async function startHarness(): Promise<Harness | null> {
  const server = await startPostgrest()
  if (!server) {
    console.warn(postgrestMissingMessage)
    return null
  }
  const db = await createPgClient()
  const fake = createFakeExternal()
  const env = await buildEnv(server.url)
  const app = createApp({ externalFetch: fake.fetch })
  resetDemoCache()

  const withToken = async (u: TestUser) => ({ ...u, token: await signTestJwt({ sub: u.id, email: u.email }) })

  return {
    server,
    db,
    fake,
    env,
    app,
    async call(method, path, opts = {}) {
      const headers: Record<string, string> = { ...opts.headers }
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`
      let body: string | undefined
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
      }
      const res = await app.request(path, { method, headers, body }, opts.env ?? env)
      const text = await res.text()
      let parsed: unknown = text
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        // non-JSON body (e.g. 204)
      }
      return { status: res.status, body: parsed as any, headers: res.headers }
    },
    user: async (prefix) => withToken(await createAuthUser(db, prefix ? { email: `${prefix}-${randomBytes(4).toString('hex')}@example.test` } : {})),
    member: async (workspaceId, role) => withToken(await createMember(db, workspaceId, role)),
    envWith: (overrides) => buildEnv(server.url, overrides),
    async stop() {
      await db.end()
      await server.stop()
    },
  }
}

/** Clears per-isolate state that would otherwise leak between tests (in-memory rate limits). */
export function resetState(h: Harness | null): void {
  resetRateLimits()
  h?.fake.reset()
}

export const skipTitle = (title: string, h: Harness | null) => (h ? title : `${title} [SKIPPED: ${postgrestMissingMessage}]`)

export const leadInput = (overrides: Record<string, unknown> = {}) => ({
  name: 'Integration Lead',
  email: `lead-${randomBytes(4).toString('hex')}@example.test`,
  company: 'Integration Test Co',
  message: 'We need a customer portal built within the next two months. Budget is approved.',
  ...overrides,
})
