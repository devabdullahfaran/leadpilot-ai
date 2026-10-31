// Regression and refutation tests from the backend security review (2026-10-31).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { signTestJwt } from '../helpers/jwt'
import { leadInput, resetState, skipTitle, startHarness, type Harness } from './harness'

const h: Harness | null = await startHarness()
const suite = h ? describe : describe.skip

type Owner = Awaited<ReturnType<Harness['user']>>

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

suite(skipTitle('security review regressions (PostgREST + Postgres)', h), () => {
  let api: Harness
  let owner: Owner
  let key: string

  beforeAll(async () => {
    api = h!
    owner = await api.user('review-owner')
    const res = await api.call('POST', '/api/v1/integrations/intake-key', { token: owner.token })
    expect(res.status).toBe(201)
    key = res.body.key
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(() => resetState(h))

  describe('JWT verification', () => {
    it('rejects wrong issuer, wrong audience, non-authenticated role, alg=none and a missing subject', async () => {
      const now = Math.floor(Date.now() / 1000)
      const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
        sub: owner.id,
        role: 'authenticated',
        aud: 'authenticated',
        iss: 'http://127.0.0.1:54321/auth/v1',
        exp: now + 3600,
      })}.`
      const tokens = [
        await signTestJwt({ sub: owner.id, supabaseUrl: 'https://attacker.example' }),
        await signTestJwt({ sub: owner.id, audience: 'service' }),
        await signTestJwt({ sub: owner.id, role: 'service_role' }),
        await signTestJwt({}),
        unsigned,
      ]
      for (const token of tokens) {
        const res = await api.call('GET', '/api/v1/leads', { token })
        expect(res.status).toBe(401)
      }
    })
  })

  describe('workspace selection', () => {
    it('403 for an X-Workspace-Id the caller is not a member of', async () => {
      const other = await api.user('review-other')
      const res = await api.call('GET', '/api/v1/leads', { token: owner.token, headers: { 'X-Workspace-Id': other.workspaceId } })
      expect(res.status).toBe(403)
    })
  })

  describe('preview is read-only on every mutating route', () => {
    it('rejects writes with read_only and stores nothing', async () => {
      const routes: [string, string][] = [
        ['POST', '/api/v1/demo/leads'],
        ['PATCH', '/api/v1/demo/leads/0d3e0000-0000-4000-8000-0000000000aa'],
        ['DELETE', '/api/v1/demo/leads/0d3e0000-0000-4000-8000-0000000000aa'],
        ['POST', '/api/v1/demo/leads/0d3e0000-0000-4000-8000-0000000000aa/notes'],
        ['POST', '/api/v1/demo/leads/0d3e0000-0000-4000-8000-0000000000aa/qualify'],
        ['POST', '/api/v1/demo/leads/0d3e0000-0000-4000-8000-0000000000aa/override'],
        ['POST', '/api/v1/demo/workflows/executions/0d3e0000-0000-4000-8000-0000000000aa/retry'],
        ['PUT', '/api/v1/demo/settings/ai'],
        ['PATCH', '/api/v1/demo/settings/workspace'],
        ['POST', '/api/v1/demo/settings/sample-data'],
        ['DELETE', '/api/v1/demo/settings/sample-data'],
        ['PUT', '/api/v1/demo/integrations/slack'],
        ['DELETE', '/api/v1/demo/integrations/slack'],
        ['POST', '/api/v1/demo/integrations/slack/test'],
        ['POST', '/api/v1/demo/integrations/intake-key'],
      ]
      for (const [method, path] of routes) {
        const res = await api.call(method, path, { body: {} })
        expect(res.status, `${method} ${path}`).toBe(403)
        expect(res.body.error.code, `${method} ${path}`).toBe('read_only')
      }
      expect(api.fake.calls).toEqual([])
    })
  })

  describe('search filter construction', () => {
    it('PostgREST logic-tree metacharacters in q cannot widen the filter', async () => {
      const tag = `rv${Date.now().toString(36)}`
      const created = await api.call('POST', '/api/v1/leads', { token: owner.token, body: leadInput({ name: `Target ${tag}` }) })
      expect(created.status).toBe(201)
      for (const q of ['x),id.not.is.null,name.eq.(x', 'x",name.neq."', 'a\\', '"),or(id.not.is.null']) {
        const res = await api.call('GET', `/api/v1/leads?q=${encodeURIComponent(q)}`, { token: owner.token })
        expect(res.status, q).toBe(200)
        expect(res.body.total, q).toBe(0)
      }
    })
  })

  describe('over-long websites', () => {
    // A 300-character website passes validation, but normalizing it adds "https://", which would exceed the
    // 300-character column check and fail the whole request with a leaked constraint message.
    const longWebsite = `${'a'.repeat(290)}.example`

    it('intake keeps the website as entered instead of failing', async () => {
      const body = leadInput({ website: longWebsite, message: 'We need a quote for a new customer portal.' })
      const res = await api.call('POST', `/api/v1/intake/${owner.workspaceId}`, { body, headers: { 'X-Intake-Key': key } })
      expect(res.status).toBe(201)
      const row = await api.db.query('select website from public.leads where id = $1', [res.body.leadId])
      expect(row.rows[0].website).toBe(longWebsite)
    })

    it('create and update keep the website as entered instead of failing', async () => {
      const created = await api.call('POST', '/api/v1/leads', { token: owner.token, body: leadInput({ website: longWebsite }) })
      expect(created.status).toBe(201)
      expect(created.body.lead.website).toBe(longWebsite)
      const plain = await api.call('POST', '/api/v1/leads', { token: owner.token, body: leadInput() })
      const updated = await api.call('PATCH', `/api/v1/leads/${plain.body.lead.id}`, { token: owner.token, body: { website: longWebsite } })
      expect(updated.status).toBe(200)
      expect(updated.body.website).toBe(longWebsite)
    })
  })
})
