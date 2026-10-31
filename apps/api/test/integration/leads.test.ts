// Leads API end to end: auth, workspace selection, CRUD with role checks, search/filter/sort/paging,
// duplicates, notes, cross-workspace isolation, dashboard and analytics shapes.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { signTestJwt } from '../helpers/jwt'
import { leadInput, resetState, skipTitle, startHarness, type Harness } from './harness'

const h: Harness | null = await startHarness()
const suite = h ? describe : describe.skip

type Owner = Awaited<ReturnType<Harness['user']>>

suite(skipTitle('leads API (PostgREST + Postgres)', h), () => {
  let api: Harness
  let owner: Owner
  let other: Owner

  beforeAll(async () => {
    api = h!
    owner = await api.user('owner')
    other = await api.user('other')
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(() => resetState(h))

  describe('authentication and workspace selection', () => {
    it('401 without a token, with a bad signature, and with an expired token', async () => {
      expect((await api.call('GET', '/api/v1/leads')).status).toBe(401)
      const forged = await signTestJwt({ sub: owner.id, secret: 'a-completely-different-secret-value' })
      expect((await api.call('GET', '/api/v1/leads', { token: forged })).status).toBe(401)
      const expired = await signTestJwt({ sub: owner.id, expiresIn: -60 })
      const res = await api.call('GET', '/api/v1/leads', { token: expired })
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('unauthorized')
    })

    it('GET /me returns the personal workspace as active', async () => {
      const res = await api.call('GET', '/api/v1/me', { token: owner.token })
      expect(res.status).toBe(200)
      expect(res.body.activeWorkspaceId).toBe(owner.workspaceId)
      expect(res.body.workspaces).toEqual([expect.objectContaining({ id: owner.workspaceId, role: 'owner', isDemo: false })])
    })

    it('403 when X-Workspace-Id names a workspace the caller is not a member of', async () => {
      const res = await api.call('GET', '/api/v1/leads', { token: owner.token, headers: { 'X-Workspace-Id': other.workspaceId } })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('forbidden')
    })
  })

  describe('CRUD and roles', () => {
    it('creates, reads, updates and deletes a lead with role checks', async () => {
      const input = leadInput({ phone: '+1 (555) 010-2000' })
      const created = await api.call('POST', '/api/v1/leads', { token: owner.token, body: input })
      expect(created.status).toBe(201)
      const lead = created.body.lead
      expect(lead).toMatchObject({ name: input.name, email: input.email, status: 'new', qualificationStatus: 'pending', isSample: false })

      const got = await api.call('GET', `/api/v1/leads/${lead.id}`, { token: owner.token })
      expect(got.status).toBe(200)
      expect(got.body.id).toBe(lead.id)

      const viewer = await api.member(owner.workspaceId, 'viewer')
      const member = await api.member(owner.workspaceId, 'member')
      const admin = await api.member(owner.workspaceId, 'admin')
      const ws = { 'X-Workspace-Id': owner.workspaceId }

      // Viewer: read yes, write no.
      expect((await api.call('GET', `/api/v1/leads/${lead.id}`, { token: viewer.token, headers: ws })).status).toBe(200)
      const viewerCreate = await api.call('POST', '/api/v1/leads', { token: viewer.token, headers: ws, body: leadInput() })
      expect(viewerCreate.status).toBe(403)
      expect(viewerCreate.body.error.code).toBe('forbidden')
      expect((await api.call('PATCH', `/api/v1/leads/${lead.id}`, { token: viewer.token, headers: ws, body: { status: 'contacted' } })).status).toBe(403)

      // Member: update yes, delete no.
      const patched = await api.call('PATCH', `/api/v1/leads/${lead.id}`, { token: member.token, headers: ws, body: { status: 'contacted' } })
      expect(patched.status).toBe(200)
      expect(patched.body.status).toBe('contacted')
      const activities = await api.call('GET', `/api/v1/leads/${lead.id}/activities`, { token: member.token, headers: ws })
      expect(activities.body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['lead_created', 'status_changed']))
      expect((await api.call('DELETE', `/api/v1/leads/${lead.id}`, { token: member.token, headers: ws })).status).toBe(403)

      // Admin: delete yes.
      const deleted = await api.call('DELETE', `/api/v1/leads/${lead.id}`, { token: admin.token, headers: ws })
      expect(deleted.status).toBe(204)
      expect((await api.call('GET', `/api/v1/leads/${lead.id}`, { token: owner.token })).status).toBe(404)
    })

    it('rejects invalid bodies with 422 validation details', async () => {
      const res = await api.call('POST', '/api/v1/leads', { token: owner.token, body: { name: 'x', email: 'not-an-email' } })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('validation_error')
      expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'email' })]))
    })

    it('duplicate email → 409 duplicate_lead with existingLeadId; duplicates endpoint finds it', async () => {
      const input = leadInput({ company: 'Dupe Check Ltd', phone: '+1 555 010 3000' })
      const first = await api.call('POST', '/api/v1/leads', { token: owner.token, body: input })
      expect(first.status).toBe(201)
      const again = await api.call('POST', '/api/v1/leads', { token: owner.token, body: { ...input, email: input.email.toUpperCase() } })
      expect(again.status).toBe(409)
      expect(again.body.error.code).toBe('duplicate_lead')
      expect(again.body.error.details.existingLeadId).toBe(first.body.lead.id)

      const q = new URLSearchParams({ email: input.email, company: 'dupe check ltd', phone: '+15550103000' })
      const dupes = await api.call('GET', `/api/v1/leads/duplicates?${q}`, { token: owner.token })
      expect(dupes.status).toBe(200)
      const match = dupes.body.matches.find((m: { id: string }) => m.id === first.body.lead.id)
      expect(match.matchedOn.sort()).toEqual(['company', 'email', 'phone'])

      const excluded = await api.call('GET', `/api/v1/leads/duplicates?email=${encodeURIComponent(input.email)}&excludeId=${first.body.lead.id}`, {
        token: owner.token,
      })
      expect(excluded.body.matches).toEqual([])
    })

    it('adds notes and lists them in the timeline', async () => {
      const lead = (await api.call('POST', '/api/v1/leads', { token: owner.token, body: leadInput() })).body.lead
      const note = await api.call('POST', `/api/v1/leads/${lead.id}/notes`, { token: owner.token, body: { body: 'Called, left voicemail.' } })
      expect(note.status).toBe(201)
      expect(note.body).toMatchObject({ leadId: lead.id, type: 'note_added', body: 'Called, left voicemail.' })
      const timeline = await api.call('GET', `/api/v1/leads/${lead.id}/activities`, { token: owner.token })
      expect(timeline.body.data[0].id).toBe(note.body.id)
    })
  })

  describe('list: search, filter, sort, paginate', () => {
    const tag = `zq${Date.now().toString(36)}`
    beforeAll(async () => {
      for (const [name, status] of [
        ['Alpha', 'new'],
        ['Bravo', 'contacted'],
        ['Charlie', 'new'],
      ] as const) {
        const res = await api.call('POST', '/api/v1/leads', {
          token: owner.token,
          body: leadInput({ name: `${name} ${tag}`, company: `${tag} ${name} Inc`, status, source: 'referral' }),
        })
        expect(res.status).toBe(201)
      }
    })

    it('searches case-insensitively and filters by status', async () => {
      const all = await api.call('GET', `/api/v1/leads?q=${tag.toUpperCase()}`, { token: owner.token })
      expect(all.status).toBe(200)
      expect(all.body.total).toBe(3)
      const contacted = await api.call('GET', `/api/v1/leads?q=${tag}&status=contacted`, { token: owner.token })
      expect(contacted.body.data.map((l: { name: string }) => l.name)).toEqual([`Bravo ${tag}`])
    })

    it('treats LIKE wildcards in q literally', async () => {
      const res = await api.call('GET', `/api/v1/leads?q=${encodeURIComponent('%_%')}`, { token: owner.token })
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(0)
    })

    it('sorts and paginates', async () => {
      const page2 = await api.call('GET', `/api/v1/leads?q=${tag}&sort=name&order=asc&pageSize=2&page=2`, { token: owner.token })
      expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 })
      expect(page2.body.data.map((l: { name: string }) => l.name)).toEqual([`Charlie ${tag}`])
      const desc = await api.call('GET', `/api/v1/leads?q=${tag}&sort=name&order=desc`, { token: owner.token })
      expect(desc.body.data.map((l: { name: string }) => l.name)).toEqual([`Charlie ${tag}`, `Bravo ${tag}`, `Alpha ${tag}`])
    })
  })

  describe('cross-workspace isolation', () => {
    it("user B cannot read, update, delete or annotate user A's lead", async () => {
      const lead = (await api.call('POST', '/api/v1/leads', { token: owner.token, body: leadInput() })).body.lead
      expect((await api.call('GET', `/api/v1/leads/${lead.id}`, { token: other.token })).status).toBe(404)
      expect((await api.call('PATCH', `/api/v1/leads/${lead.id}`, { token: other.token, body: { status: 'lost' } })).status).toBe(404)
      expect((await api.call('DELETE', `/api/v1/leads/${lead.id}`, { token: other.token })).status).toBe(404)
      expect((await api.call('POST', `/api/v1/leads/${lead.id}/notes`, { token: other.token, body: { body: 'sneaky' } })).status).toBe(404)
      const list = await api.call('GET', '/api/v1/leads?pageSize=100', { token: other.token })
      expect(list.body.data.some((l: { id: string }) => l.id === lead.id)).toBe(false)
      const { rows } = await api.db.query('select status from public.leads where id = $1', [lead.id])
      expect(rows[0].status).toBe('new')
    })
  })

  describe('dashboard and analytics', () => {
    it('GET /dashboard/summary has the documented shape', async () => {
      const res = await api.call('GET', '/api/v1/dashboard/summary', { token: owner.token })
      expect(res.status).toBe(200)
      expect(res.body.totals).toEqual({
        leads: expect.any(Number),
        qualified: expect.any(Number),
        highPriority: expect.any(Number),
        needsReview: expect.any(Number),
      })
      expect(res.body.totals.leads).toBeGreaterThan(0)
      expect(Array.isArray(res.body.conversion)).toBe(true)
      expect(res.body.aiActivity).toMatchObject({ todayUsed: expect.any(Number), dailyLimit: 50 })
    })

    it('GET /analytics validates days and returns series', async () => {
      const res = await api.call('GET', '/api/v1/analytics?days=7', { token: owner.token })
      expect(res.status).toBe(200)
      expect(res.body.days).toBe(7)
      for (const key of ['leadVolume', 'sources', 'scoreDistribution', 'qualificationResults', 'priorities', 'workflowOutcomes']) {
        expect(Array.isArray(res.body[key]), key).toBe(true)
      }
      expect(res.body.sources).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'referral' })]))
      expect((await api.call('GET', '/api/v1/analytics?days=3', { token: owner.token })).status).toBe(422)
    })
  })
})
