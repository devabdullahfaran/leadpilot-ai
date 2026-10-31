import type { Lead, LeadQualification } from '@leadpilot/shared'
import { describe, expect, it } from 'vitest'
import { encryptSecret } from '../../src/services/crypto'
import { buildLeadAlert, escapeSlack, meetsMinPriority, notifySlackForLead, postToSlack } from '../../src/services/slack'
import { createFakeDb, testConfig, testContext, WORKSPACE_ID } from './helpers/fake-db'

const WEBHOOK = 'https://hooks.slack.com/services/T0001/B0001/abcdefghijklmnop'

const lead: Lead = {
  id: '33333333-3333-4333-8333-333333333333',
  workspaceId: WORKSPACE_ID,
  name: '<!channel> Mallory & Co',
  email: 'mallory@example.com',
  phone: null,
  company: 'Evil <script> Corp',
  jobTitle: null,
  website: null,
  source: 'website_form',
  message: 'Hi',
  status: 'new',
  score: 85,
  priority: 'high',
  category: 'software_development',
  aiSummary: 'Wants a <https://phish.example|login page>',
  recommendedAction: 'Call > email',
  confidence: 0.9,
  qualificationStatus: 'completed',
  qualificationError: null,
  lastQualifiedAt: null,
  owner: null,
  isSample: false,
  submissionCount: 1,
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
}

const qualification: LeadQualification = {
  id: '44444444-4444-4444-8444-444444444444',
  leadId: lead.id,
  source: 'ai',
  score: 85,
  priority: 'high',
  category: 'software_development',
  summary: 'Wants a <https://phish.example|login page>',
  reasoning: 'r',
  recommendedAction: 'Call > email',
  confidence: 0.9,
  criteria: [],
  adjustments: [],
  model: 'gemini-3.5-flash-lite',
  promptVersion: 'lp-qualify-v1',
  overrideReason: null,
  createdBy: null,
  isSample: false,
  createdAt: '2026-10-31T00:00:00.000Z',
}

describe('buildLeadAlert', () => {
  it('builds a Block Kit message with the required fields', () => {
    const msg = buildLeadAlert(lead, qualification)
    const json = JSON.stringify(msg)
    expect(msg.blocks[0]).toMatchObject({ type: 'header', text: { type: 'plain_text' } })
    expect(json).toContain(':red_circle:')
    for (const label of ['Lead name', 'Company', 'Score', 'Priority', 'Recommended action', 'Inquiry summary']) {
      expect(json).toContain(`*${label}*`)
    }
    expect(json).toContain('85/100')
    expect(json).toContain('AI-generated estimate')
    expect(json).toContain('confidence 90%')
  })

  it('escapes &, < and > in user content so it cannot inject mentions or links', () => {
    const json = JSON.stringify(buildLeadAlert(lead, qualification))
    expect(json).not.toContain('<!channel>')
    expect(json).not.toContain('<https://phish.example')
    expect(json).not.toContain('<script>')
    expect(json).toContain('&lt;!channel&gt; Mallory &amp; Co')
    expect(json).toContain('Call &gt; email')
    expect(escapeSlack('a & <b>')).toBe('a &amp; &lt;b&gt;')
  })

  it('labels sample data and adds a lead link only when an app URL is given', () => {
    const plain = JSON.stringify(buildLeadAlert({ ...lead, isSample: true }, qualification))
    expect(plain).toContain('sample data')
    expect(plain).not.toContain('Open lead')
    const linked = JSON.stringify(buildLeadAlert(lead, qualification, 'https://app.example/'))
    expect(linked).toContain(`<https://app.example/leads/${lead.id}|Open lead in LeadPilot>`)
  })
})

describe('meetsMinPriority', () => {
  it('ranks high > medium > low', () => {
    expect(meetsMinPriority('high', 'high')).toBe(true)
    expect(meetsMinPriority('medium', 'high')).toBe(false)
    expect(meetsMinPriority('medium', 'medium')).toBe(true)
    expect(meetsMinPriority('low', 'medium')).toBe(false)
    expect(meetsMinPriority('low', 'low')).toBe(true)
  })
})

describe('postToSlack', () => {
  const message = buildLeadAlert(lead, qualification)

  it('returns ok on 2xx and posts JSON', async () => {
    let body = ''
    const result = await postToSlack(
      WEBHOOK,
      message,
      (async (_url: RequestInfo | URL, init?: RequestInit) => {
        body = String(init?.body)
        return new Response('ok', { status: 200 })
      }) as typeof fetch,
    )
    expect(result).toEqual({ ok: true })
    expect(JSON.parse(body).blocks).toHaveLength(message.blocks.length)
  })

  it('treats non-2xx as failure and surfaces Slack’s plain-text error without the URL', async () => {
    const result = await postToSlack(WEBHOOK, message, (async () => new Response('invalid_token', { status: 403 })) as typeof fetch)
    expect(result).toEqual({ ok: false, status: 403, error: 'Slack returned HTTP 403: invalid_token' })

    const echo = await postToSlack(WEBHOOK, message, (async () => new Response(`no_service ${WEBHOOK}`, { status: 404 })) as typeof fetch)
    expect(echo.ok).toBe(false)
    expect(JSON.stringify(echo)).not.toContain(WEBHOOK)
  })

  it('handles network errors without leaking the URL', async () => {
    const result = await postToSlack(
      WEBHOOK,
      message,
      (async () => {
        throw new TypeError(`fetch failed for ${WEBHOOK}`)
      }) as typeof fetch,
    )
    expect(result).toEqual({ ok: false, status: null, error: 'Could not reach Slack (network error)' })
  })

  it('times out when Slack never answers', async () => {
    const result = await postToSlack(WEBHOOK, message, (() => new Promise<Response>(() => {})) as typeof fetch, 20)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBeNull()
    expect(result.error).toMatch(/did not respond/)
  })
})

describe('notifySlackForLead', () => {
  async function setup(options: { enabled?: boolean; minPriority?: string; slackStatus?: number; noSettings?: boolean } = {}) {
    const encryptionKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    const ciphertext = await encryptSecret(WEBHOOK, encryptionKey)
    const posted: string[] = []
    const { db, calls } = createFakeDb((call) => {
      if (call.table === 'integration_settings' && call.op === 'select') {
        if (options.noSettings) return { data: null, error: null }
        return {
          data: { enabled: options.enabled ?? true, config: { minPriority: options.minPriority ?? 'high', webhookHint: 'hooks.slack.com/…/mnop' } },
          error: null,
        }
      }
      if (call.table === 'integration_secrets') return { data: { ciphertext }, error: null }
      return { data: null, error: null }
    })
    const fetchImpl = (async (url: RequestInfo | URL) => {
      posted.push(String(url))
      return new Response(options.slackStatus === 500 ? 'internal_error' : 'ok', { status: options.slackStatus ?? 200 })
    }) as typeof fetch
    const ctx = testContext(db, { config: testConfig({ encryptionKey }), fetch: fetchImpl })
    return { ctx, calls, posted }
  }

  it('sends, records a notification event with a minimal payload and a lead activity', async () => {
    const { ctx, calls, posted } = await setup()
    const outcome = await notifySlackForLead(ctx, lead, qualification)
    expect(outcome).toEqual({ status: 'sent' })
    expect(posted).toEqual([WEBHOOK])
    const event = calls.find((c) => c.table === 'notification_events')!
    expect(event.payload).toMatchObject({
      workspace_id: WORKSPACE_ID,
      status: 'sent',
      payload: { leadName: lead.name, company: lead.company, score: 85, priority: 'high' },
    })
    expect(Object.keys((event.payload as { payload: object }).payload)).toHaveLength(4)
    expect(calls.find((c) => c.table === 'lead_activities')?.payload).toMatchObject({ type: 'notification_sent' })
  })

  it('skips without posting when priority is below the threshold', async () => {
    const { ctx, calls, posted } = await setup({ minPriority: 'high' })
    const outcome = await notifySlackForLead(ctx, lead, { ...qualification, priority: 'medium' })
    expect(outcome).toEqual({ status: 'skipped', reason: 'Priority medium is below the Slack threshold (high)' })
    expect(posted).toHaveLength(0)
    expect(calls.some((c) => c.table === 'notification_events')).toBe(false)
  })

  it('skips when Slack is not configured or disabled', async () => {
    for (const opts of [{ noSettings: true }, { enabled: false }]) {
      const { ctx, posted } = await setup(opts)
      const outcome = await notifySlackForLead(ctx, lead, qualification)
      expect(outcome.status).toBe('skipped')
      expect(posted).toHaveLength(0)
    }
  })

  it('records a failure (event + activity) when Slack returns an error', async () => {
    const { ctx, calls } = await setup({ slackStatus: 500 })
    const outcome = await notifySlackForLead(ctx, lead, qualification)
    expect(outcome).toEqual({ status: 'failed', error: 'Slack returned HTTP 500: internal_error' })
    expect(calls.find((c) => c.table === 'notification_events')?.payload).toMatchObject({ status: 'failed' })
    expect(calls.find((c) => c.table === 'lead_activities')?.payload).toMatchObject({ type: 'notification_failed' })
  })
})
