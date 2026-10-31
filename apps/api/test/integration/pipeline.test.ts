// AI qualification, Slack notification, retry, override, webhook intake and the read-only portfolio
// preview, end to end. Gemini and Slack are faked through externalFetch.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SLACK_WEBHOOK, leadInput, resetState, skipTitle, startHarness, type Harness } from './harness'

const h: Harness | null = await startHarness()
const suite = h ? describe : describe.skip

type Owner = Awaited<ReturnType<Harness['user']>>

const DEMO_WORKSPACE_ID = '0d3e0000-0000-4000-8000-000000000001'

suite(skipTitle('AI pipeline, intake and preview (PostgREST + Postgres)', h), () => {
  let api: Harness
  let owner: Owner

  const createLead = async (token: string, overrides: Record<string, unknown> = {}) => {
    const res = await api.call('POST', '/api/v1/leads', { token, body: leadInput(overrides) })
    expect(res.status).toBe(201)
    return res.body.lead as { id: string; email: string }
  }
  const executionsFor = async (leadId: string) =>
    (
      await api.db.query<{ id: string; status: string; error_code: string | null; trigger: string; attempt: number; retry_of_id: string | null }>(
        "select * from public.workflow_executions where lead_id = $1 and workflow_key = 'lead_qualification' order by started_at",
        [leadId],
      )
    ).rows

  beforeAll(async () => {
    api = h!
    owner = await api.user('ai-owner')
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(() => resetState(h))

  describe('qualify', () => {
    it('persists the qualification, lead fields, a succeeded execution and a usage row', async () => {
      const lead = await createLead(owner.token)
      const res = await api.call('POST', `/api/v1/leads/${lead.id}/qualify`, { token: owner.token })
      expect(res.status).toBe(200)
      expect(res.body.lead).toMatchObject({ id: lead.id, score: 85, priority: 'high', category: 'software_development', qualificationStatus: 'completed' })
      expect(res.body.qualification).toMatchObject({ source: 'ai', score: 85, priority: 'high', confidence: 0.9 })
      expect(res.body.execution).toMatchObject({ status: 'succeeded', trigger: 'manual', leadId: lead.id })
      expect(api.fake.calls.map((c) => c.host)).toEqual(['generativelanguage.googleapis.com'])
      // Only the email domain is sent to the model.
      expect(api.fake.calls[0].body).not.toContain(lead.email)

      const q = await api.db.query('select score, source, execution_id from public.lead_qualifications where lead_id = $1', [lead.id])
      expect(q.rows).toEqual([{ score: 85, source: 'ai', execution_id: res.body.execution.id }])
      const l = await api.db.query('select score, priority, qualification_status, last_qualified_at from public.leads where id = $1', [lead.id])
      expect(l.rows[0]).toMatchObject({ score: 85, priority: 'high', qualification_status: 'completed' })
      expect(l.rows[0].last_qualified_at).not.toBeNull()
      expect((await executionsFor(lead.id)).map((e) => e.status)).toEqual(['succeeded'])
      const usage = await api.db.query('select status, prompt_tokens, output_tokens from public.ai_usage_events where lead_id = $1', [lead.id])
      expect(usage.rows).toEqual([{ status: 'success', prompt_tokens: 120, output_tokens: 60 }])

      const history = await api.call('GET', `/api/v1/leads/${lead.id}/qualifications`, { token: owner.token })
      expect(history.body.data).toHaveLength(1)
    })

    it('invalid AI JSON → 502 ai_invalid_response, execution failed, lead failed', async () => {
      const lead = await createLead(owner.token)
      api.fake.gemini = 'invalid_json'
      const res = await api.call('POST', `/api/v1/leads/${lead.id}/qualify`, { token: owner.token })
      expect(res.status).toBe(502)
      expect(res.body.error.code).toBe('ai_invalid_response')
      const execs = await executionsFor(lead.id)
      expect(execs).toEqual([expect.objectContaining({ status: 'failed', error_code: 'ai_invalid_response' })])
      const l = await api.db.query('select qualification_status, score from public.leads where id = $1', [lead.id])
      expect(l.rows[0]).toEqual({ qualification_status: 'failed', score: null })
      const usage = await api.db.query('select status from public.ai_usage_events where lead_id = $1', [lead.id])
      expect(usage.rows).toEqual([{ status: 'invalid_response' }])
      expect((await api.db.query('select 1 from public.lead_qualifications where lead_id = $1', [lead.id])).rowCount).toBe(0)
    })

    it('AI_ENABLED=false → 503 ai_disabled without calling Gemini', async () => {
      const lead = await createLead(owner.token)
      const env = await api.envWith({ AI_ENABLED: 'false' })
      const res = await api.call('POST', `/api/v1/leads/${lead.id}/qualify`, { token: owner.token, env })
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('ai_disabled')
      expect(api.fake.calls).toEqual([])
      const l = await api.db.query('select qualification_status from public.leads where id = $1', [lead.id])
      expect(l.rows[0].qualification_status).toBe('skipped')
    })

    it('workspace quota exhausted → 429 ai_quota_exceeded without calling Gemini', async () => {
      const lead = await createLead(owner.token)
      const env = await api.envWith({ AI_DAILY_LIMIT_PER_WORKSPACE: '0' })
      const res = await api.call('POST', `/api/v1/leads/${lead.id}/qualify`, { token: owner.token, env })
      expect(res.status).toBe(429)
      expect(res.body.error).toMatchObject({ code: 'ai_quota_exceeded', details: expect.objectContaining({ reason: 'workspace_daily_limit' }) })
      expect(api.fake.calls).toEqual([])
      expect((await executionsFor(lead.id)).map((e) => e.status)).toEqual(['failed'])
    })

    it('viewer cannot qualify (403)', async () => {
      const lead = await createLead(owner.token)
      const viewer = await api.member(owner.workspaceId, 'viewer')
      const res = await api.call('POST', `/api/v1/leads/${lead.id}/qualify`, { token: viewer.token, headers: { 'X-Workspace-Id': owner.workspaceId } })
      expect(res.status).toBe(403)
      expect(api.fake.calls).toEqual([])
    })

    it('manual override writes a manual qualification and updates the lead', async () => {
      const lead = await createLead(owner.token)
      const res = await api.call('POST', `/api/v1/leads/${lead.id}/override`, {
        token: owner.token,
        body: { score: 40, priority: 'medium', category: 'consulting', reason: 'Spoke on the phone; smaller scope.' },
      })
      expect(res.status).toBe(200)
      expect(res.body.qualification).toMatchObject({ source: 'manual', score: 40, priority: 'medium', overrideReason: 'Spoke on the phone; smaller scope.' })
      expect(res.body.lead).toMatchObject({ score: 40, priority: 'medium', category: 'consulting', qualificationStatus: 'completed' })
      const timeline = await api.call('GET', `/api/v1/leads/${lead.id}/activities`, { token: owner.token })
      expect(timeline.body.data[0].type).toBe('qualification_override')
    })
  })

  describe('Slack notification and retry', () => {
    let slackOwner: Owner

    beforeAll(async () => {
      slackOwner = await api.user('slack-owner')
      const res = await api.call('PUT', '/api/v1/integrations/slack', {
        token: slackOwner.token,
        body: { webhookUrl: SLACK_WEBHOOK, enabled: true, minPriority: 'low' },
      })
      expect(res.status).toBe(200)
      // The webhook URL is stored encrypted and never returned.
      expect(JSON.stringify(res.body)).not.toContain(SLACK_WEBHOOK)
    })

    it('Slack failure → execution partial + failed notification; retry → succeeded + sent', async () => {
      const lead = await createLead(slackOwner.token)
      api.fake.slackStatus = 500
      const res = await api.call('POST', `/api/v1/leads/${lead.id}/qualify`, { token: slackOwner.token })
      expect(res.status).toBe(200)
      expect(res.body.execution).toMatchObject({ status: 'partial', errorCode: 'integration_failed' })
      expect(res.body.lead.qualificationStatus).toBe('completed')
      const failedId = res.body.execution.id as string
      const n1 = await api.db.query('select status, error from public.notification_events where execution_id = $1', [failedId])
      expect(n1.rows).toEqual([expect.objectContaining({ status: 'failed' })])
      expect(n1.rows[0].error).toContain('HTTP 500')

      const detail = await api.call('GET', `/api/v1/workflows/executions/${failedId}`, { token: slackOwner.token })
      expect(detail.status).toBe(200)
      expect(detail.body.notifications).toEqual([expect.objectContaining({ status: 'failed' })])

      api.fake.slackStatus = 200
      const retry = await api.call('POST', `/api/v1/workflows/executions/${failedId}/retry`, { token: slackOwner.token })
      expect(retry.status).toBe(200)
      expect(retry.body.execution).toMatchObject({ status: 'succeeded', trigger: 'retry', attempt: 2, retryOfId: failedId })
      const n2 = await api.db.query('select status from public.notification_events where execution_id = $1', [retry.body.execution.id])
      expect(n2.rows).toEqual([{ status: 'sent' }])
      expect(api.fake.calls.filter((c) => c.host === 'hooks.slack.com')).toHaveLength(2)

      // A succeeded execution cannot be retried.
      const again = await api.call('POST', `/api/v1/workflows/executions/${retry.body.execution.id}/retry`, { token: slackOwner.token })
      expect(again.status).toBe(409)
    })
  })

  describe('webhook intake', () => {
    let intakeOwner: Owner
    let key: string
    const path = () => `/api/v1/intake/${intakeOwner.workspaceId}`
    const submission = (overrides: Record<string, unknown> = {}) =>
      leadInput({ message: 'Looking for help automating our sales follow-ups.', ...overrides })

    beforeAll(async () => {
      intakeOwner = await api.user('intake-owner')
      const res = await api.call('POST', '/api/v1/integrations/intake-key', { token: intakeOwner.token })
      expect(res.status).toBe(201)
      key = res.body.key
      expect(key).toMatch(/^lpk_/)
    })

    it('401 for a missing or wrong key and for an unknown workspace (same message)', async () => {
      const body = submission()
      const missing = await api.call('POST', path(), { body })
      const wrong = await api.call('POST', path(), { body, headers: { 'X-Intake-Key': 'lpk_wrong' } })
      const unknown = await api.call('POST', '/api/v1/intake/11111111-1111-4111-8111-111111111111', { body, headers: { 'X-Intake-Key': key } })
      for (const res of [missing, wrong, unknown]) {
        expect(res.status).toBe(401)
        expect(res.body.error.message).toBe(missing.body.error.message)
      }
    })

    it('honeypot → 202 and nothing stored', async () => {
      const body = submission({ hp: 'http://spam.example' })
      const res = await api.call('POST', path(), { body, headers: { 'X-Intake-Key': key } })
      expect(res.status).toBe(202)
      expect(res.body).toEqual({ accepted: true })
      expect((await api.db.query('select 1 from public.leads where email = $1', [body.email])).rowCount).toBe(0)
      expect(api.fake.calls).toEqual([])
    })

    it('new → 201, duplicate → 200 with submission_count, same Idempotency-Key → replay', async () => {
      const body = submission()
      const created = await api.call('POST', path(), { body, headers: { 'X-Intake-Key': key, 'Idempotency-Key': 'intake-test-0001' } })
      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({ duplicate: false, replayed: false, leadId: expect.any(String), qualificationStatus: 'completed' })

      const replay = await api.call('POST', path(), { body, headers: { 'X-Intake-Key': key, 'Idempotency-Key': 'intake-test-0001' } })
      expect(replay.status).toBe(200)
      expect(replay.body).toMatchObject({ leadId: created.body.leadId, executionId: created.body.executionId, replayed: true })

      const dup = await api.call('POST', path(), {
        body: { ...body, message: 'Following up on my earlier request about sales automation.' },
        headers: { 'X-Intake-Key': key, 'Idempotency-Key': 'intake-test-0002' },
      })
      expect(dup.status).toBe(200)
      expect(dup.body).toMatchObject({ leadId: created.body.leadId, duplicate: true, replayed: false })

      const { rows } = await api.db.query('select submission_count, workspace_id from public.leads where id = $1', [created.body.leadId])
      expect(rows[0]).toEqual({ submission_count: 2, workspace_id: intakeOwner.workspaceId })
      const execs = await api.db.query("select count(*)::int as n from public.workflow_executions where lead_id = $1 and workflow_key = 'lead_intake'", [
        created.body.leadId,
      ])
      expect(execs.rows[0].n).toBe(2)
    })

    it('rejects submissions to the preview workspace', async () => {
      const res = await api.call('POST', `/api/v1/intake/${DEMO_WORKSPACE_ID}`, { body: submission(), headers: { 'X-Intake-Key': key } })
      expect(res.status).toBe(403)
    })
  })

  describe('portfolio preview (demo)', () => {
    it('GET works without auth and only returns sample rows from the demo workspace', async () => {
      const list = await api.call('GET', '/api/v1/demo/leads?pageSize=100')
      expect(list.status).toBe(200)
      expect(list.body.total).toBeGreaterThan(0)
      expect(list.body.data.every((l: { isSample: boolean }) => l.isSample)).toBe(true)
      const ids = list.body.data.map((l: { id: string }) => l.id)
      const { rows } = await api.db.query<{ workspace_id: string }>('select distinct workspace_id from public.leads where id = any($1::uuid[])', [ids])
      expect(rows).toEqual([{ workspace_id: DEMO_WORKSPACE_ID }])

      for (const p of ['/api/v1/demo/dashboard/summary', '/api/v1/demo/analytics?days=30', '/api/v1/demo/workflows/overview', '/api/v1/demo/integrations']) {
        expect((await api.call('GET', p)).status, p).toBe(200)
      }
    })

    it("never exposes other workspaces' records by id", async () => {
      const lead = await createLead(owner.token)
      const res = await api.call('GET', `/api/v1/demo/leads/${lead.id}`)
      expect(res.status).toBe(404)
      const search = await api.call('GET', `/api/v1/demo/leads?q=${encodeURIComponent(lead.email)}`)
      expect(search.body.total).toBe(0)
    })

    it('mutations → 403 read_only', async () => {
      const list = await api.call('GET', '/api/v1/demo/leads?pageSize=1')
      const id = list.body.data[0].id
      const attempts: [string, string, unknown][] = [
        ['POST', '/api/v1/demo/leads', leadInput()],
        ['PATCH', `/api/v1/demo/leads/${id}`, { status: 'lost' }],
        ['DELETE', `/api/v1/demo/leads/${id}`, undefined],
        ['POST', `/api/v1/demo/leads/${id}/qualify`, undefined],
        ['PUT', '/api/v1/demo/settings/ai', {}],
      ]
      for (const [method, p, body] of attempts) {
        const res = await api.call(method, p, { body })
        expect(res.status, `${method} ${p}`).toBe(403)
        expect(res.body.error.code).toBe('read_only')
      }
      expect(api.fake.calls).toEqual([])
    })
  })
})
