// qualifyLead / processIntake orchestration against the fake PostgREST client and a fake Gemini fetch.
// These check ordering, bookkeeping and error mapping; SQL behaviour (RLS, quotas, constraints) is covered
// by the integration suite.
import type { Intake } from '@leadpilot/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/env'
import type { LeadRow } from '../../src/lib/mappers'
import { processIntake } from '../../src/services/intake'
import { overrideQualification, qualifyLead } from '../../src/services/qualification'
import { ACTOR_ID, createFakeDb, testConfig, testContext, WORKSPACE_ID, type FakeCall } from './helpers/fake-db'

const LEAD_ID = '77777777-7777-4777-8777-777777777777'
const EXECUTION_ID = '88888888-8888-4888-8888-888888888888'
const RESERVATION_ID = '99999999-9999-4999-8999-999999999999'

const baseLead: LeadRow = {
  id: LEAD_ID,
  workspace_id: WORKSPACE_ID,
  name: 'Ada Lovelace',
  email: 'ada@analytical.example',
  email_normalized: 'ada@analytical.example',
  phone: null,
  phone_normalized: null,
  company: 'Analytical Engines',
  job_title: 'Founder',
  website: null,
  source: 'website_form',
  message: 'We need a custom web app for scheduling. Budget $30k, launch in Q1.',
  status: 'new',
  score: null,
  priority: null,
  category: null,
  ai_summary: null,
  ai_reasoning: null,
  recommended_action: null,
  confidence: null,
  qualification_status: 'pending',
  qualification_error: null,
  last_qualified_at: null,
  owner_id: null,
  is_sample: false,
  submission_count: 1,
  created_by: null,
  created_at: '2026-10-31T09:00:00.000Z',
  updated_at: '2026-10-31T09:00:00.000Z',
  owner: null,
}

const modelOutput = {
  score: 78,
  priority: 'high',
  category: 'software_development',
  summary: 'Needs a scheduling web app.',
  reasoning: 'Clear scope, budget and timeline.',
  recommendedAction: 'Schedule a discovery call',
  confidence: 0.8,
  criteria: [
    { key: 'intent', score: 22 },
    { key: 'fit', score: 22 },
    { key: 'budget_timeline', score: 16 },
    { key: 'authority', score: 10 },
    { key: 'completeness', score: 8 },
  ],
}

const geminiOk = () =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(modelOutput) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 90 },
    }),
    { status: 200 },
  )

interface WorldOptions {
  existingLead?: LeadRow | null
  reserve?: { allowed: boolean; reason?: string | null }
  aiSettings?: Record<string, unknown> | null
  gemini?: () => Response
  config?: AppConfig
  idempotentExecution?: { id: string; status: string; result: unknown } | null
}

function world(options: WorldOptions = {}) {
  let lead: LeadRow | null = options.existingLead === undefined ? { ...baseLead } : options.existingLead
  const geminiCalls: string[] = []
  const handler = (call: FakeCall) => {
    const t = `${call.table}.${call.op}`
    switch (t) {
      case 'leads.select': {
        const byEmail = call.filters.find(([c]) => c === 'email_normalized')
        if (byEmail) return { data: lead && lead.email_normalized === byEmail[1] ? { id: lead.id, submission_count: lead.submission_count } : null, error: null }
        return { data: lead, error: null }
      }
      case 'leads.insert': {
        const p = call.payload as Partial<LeadRow>
        lead = { ...baseLead, ...p, id: LEAD_ID, email_normalized: String(p.email).toLowerCase() } as LeadRow
        return { data: { id: LEAD_ID }, error: null }
      }
      case 'leads.update':
        lead = { ...(lead as LeadRow), ...(call.payload as Partial<LeadRow>) }
        return { data: lead, error: null }
      case 'workflow_executions.select':
        return { data: options.idempotentExecution ?? null, error: null }
      case 'workflow_executions.insert':
        return { data: { id: EXECUTION_ID }, error: null }
      case 'workflow_executions.update': {
        const p = call.payload as Record<string, unknown>
        return {
          data: {
            id: EXECUTION_ID,
            workspace_id: WORKSPACE_ID,
            lead_id: p.lead_id ?? null,
            workflow_key: 'lead_qualification',
            engine: 'worker',
            trigger: 'manual',
            status: p.status,
            steps: p.steps,
            attempt: 1,
            retry_of_id: null,
            error_code: p.error_code,
            error_message: p.error_message,
            idempotency_key: null,
            result: p.result ?? null,
            started_at: '2026-10-31T10:00:00.000Z',
            finished_at: p.finished_at,
            duration_ms: p.duration_ms,
            created_by: ACTOR_ID,
            is_sample: false,
            lead: { name: 'Ada Lovelace' },
          },
          error: null,
        }
      }
      case 'integration_settings.select': {
        const provider = call.filters.find(([c]) => c === 'provider')?.[1]
        if (provider === 'ai' && options.aiSettings) return { data: { enabled: true, config: options.aiSettings }, error: null }
        return { data: null, error: null }
      }
      case 'reserve_ai_call.rpc': {
        const r = options.reserve ?? { allowed: true }
        return {
          data: [{ reservation_id: r.allowed ? RESERVATION_ID : null, allowed: r.allowed, reason: r.reason ?? null, workspace_used: 25, global_used: 40 }],
          error: null,
        }
      }
      case 'lead_qualifications.insert': {
        const p = call.payload as Record<string, unknown>
        return { data: { id: 'q1', created_at: '2026-10-31T10:00:01.000Z', is_sample: false, creator: null, ...p }, error: null }
      }
      default:
        return { data: null, error: null }
    }
  }
  const { db, calls } = createFakeDb(handler)
  const fetchImpl = (async (url: RequestInfo | URL) => {
    geminiCalls.push(String(url))
    return (options.gemini ?? geminiOk)()
  }) as typeof fetch
  const ctx = testContext(db, { config: options.config ?? testConfig(), fetch: fetchImpl })
  return { ctx, calls, geminiCalls, getLead: () => lead }
}

const callsTo = (calls: FakeCall[], table: string, op?: FakeCall['op']) => calls.filter((c) => c.table === table && (!op || c.op === op))
const executionUpdate = (calls: FakeCall[]) => callsTo(calls, 'workflow_executions', 'update').at(-1)?.payload as Record<string, unknown>

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('qualifyLead', () => {
  it('runs the full pipeline and records every step', async () => {
    const { ctx, calls, getLead } = world()
    const result = await qualifyLead(ctx, LEAD_ID, { trigger: 'manual' })

    expect(result.lead).toMatchObject({ score: 78, priority: 'high', qualificationStatus: 'completed', category: 'software_development' })
    expect(result.qualification).toMatchObject({ source: 'ai', score: 78, priority: 'high', promptVersion: 'lp-qualify-v1' })
    expect(result.execution.status).toBe('succeeded')
    expect(result.execution.steps.map((s) => `${s.key}:${s.status}`)).toEqual(['ai_classify:succeeded', 'persist:succeeded', 'notify_slack:skipped'])
    expect(getLead()?.qualification_error).toBeNull()

    const rpc = callsTo(calls, 'reserve_ai_call')[0]
    expect(rpc.payload).toMatchObject({ p_workspace_id: WORKSPACE_ID, p_user_id: ACTOR_ID, p_lead_id: LEAD_ID, p_workspace_limit: 25, p_global_limit: 150 })
    const usage = callsTo(calls, 'ai_usage_events', 'update')[0]
    expect(usage.payload).toMatchObject({ status: 'success', prompt_tokens: 300, output_tokens: 90, error_code: null })
    expect(usage.filters).toContainEqual(['id', RESERVATION_ID])
    const qual = callsTo(calls, 'lead_qualifications', 'insert')[0].payload as Record<string, unknown>
    expect(qual).toMatchObject({ workspace_id: WORKSPACE_ID, execution_id: EXECUTION_ID, model: 'gemini-3.5-flash-lite' })
    const activityTypes = callsTo(calls, 'lead_activities', 'insert').map((c) => (c.payload as { type: string }).type)
    expect(activityTypes).toEqual(['qualification_started', 'qualification_completed'])
    // Every lead query is pinned to the workspace.
    for (const c of callsTo(calls, 'leads')) expect(c.filters).toContainEqual(['workspace_id', WORKSPACE_ID])
  })

  it('throws 404 for a lead outside the workspace without starting an execution', async () => {
    const { ctx, calls } = world({ existingLead: null })
    await expect(qualifyLead(ctx, LEAD_ID, { trigger: 'manual' })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(callsTo(calls, 'workflow_executions')).toHaveLength(0)
  })

  it('global kill switch: records a skipped step, marks the lead skipped and throws ai_disabled', async () => {
    const { ctx, calls, geminiCalls, getLead } = world({ config: testConfig({ ai: { enabled: false } }) })
    await expect(qualifyLead(ctx, LEAD_ID, { trigger: 'manual' })).rejects.toMatchObject({ status: 503, code: 'ai_disabled' })
    expect(geminiCalls).toHaveLength(0)
    expect(callsTo(calls, 'reserve_ai_call')).toHaveLength(0)
    expect(getLead()?.qualification_status).toBe('skipped')
    const exec = executionUpdate(calls)
    expect(exec).toMatchObject({ status: 'failed', error_code: 'ai_disabled' })
    expect(exec.steps).toEqual([expect.objectContaining({ key: 'ai_classify', status: 'skipped' })])
    expect(callsTo(calls, 'ai_usage_events', 'insert')[0].payload).toMatchObject({ status: 'rejected_disabled' })
  })

  it('workspace setting disabled → ai_disabled', async () => {
    const { ctx, geminiCalls } = world({ aiSettings: { enabled: false } })
    await expect(qualifyLead(ctx, LEAD_ID, { trigger: 'manual' })).rejects.toMatchObject({ status: 503, code: 'ai_disabled' })
    expect(geminiCalls).toHaveLength(0)
  })

  it('missing API key → ai_not_configured', async () => {
    const { ctx, geminiCalls } = world({ config: testConfig({ gemini: { apiKey: undefined } }) })
    await expect(qualifyLead(ctx, LEAD_ID, { trigger: 'manual' })).rejects.toMatchObject({ status: 503, code: 'ai_not_configured' })
    expect(geminiCalls).toHaveLength(0)
  })

  it('quota exhausted → 429 ai_quota_exceeded with usage details, lead failed', async () => {
    const { ctx, calls, geminiCalls, getLead } = world({ reserve: { allowed: false, reason: 'workspace_daily_limit' } })
    const err = await qualifyLead(ctx, LEAD_ID, { trigger: 'manual' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 429, code: 'ai_quota_exceeded', details: { reason: 'workspace_daily_limit', workspaceUsed: 25, globalUsed: 40 } })
    expect(geminiCalls).toHaveLength(0)
    expect(getLead()?.qualification_status).toBe('failed')
    expect(executionUpdate(calls)).toMatchObject({ status: 'failed', error_code: 'ai_quota_exceeded' })
  })

  it('Gemini failure → lead failed, usage finalized, execution failed, ai_unavailable thrown', async () => {
    const { ctx, calls, getLead } = world({ gemini: () => new Response('{}', { status: 400 }) })
    await expect(qualifyLead(ctx, LEAD_ID, { trigger: 'retry', attempt: 2 })).rejects.toMatchObject({ status: 502, code: 'ai_unavailable' })
    expect(getLead()?.qualification_status).toBe('failed')
    expect(getLead()?.qualification_error).toMatch(/Gemini rejected the request/)
    expect(callsTo(calls, 'ai_usage_events', 'update')[0].payload).toMatchObject({ status: 'error', error_code: 'bad_request' })
    expect(executionUpdate(calls)).toMatchObject({ status: 'failed', error_code: 'ai_unavailable' })
    expect(callsTo(calls, 'lead_qualifications')).toHaveLength(0)
    const types = callsTo(calls, 'lead_activities', 'insert').map((c) => (c.payload as { type: string }).type)
    expect(types).toEqual(['qualification_started', 'qualification_failed'])
  })

  it('invalid model output → ai_invalid_response', async () => {
    const bad = () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"score": "high"}' }] }, finishReason: 'STOP' }] }), { status: 200 })
    const { ctx, calls } = world({ gemini: bad })
    await expect(qualifyLead(ctx, LEAD_ID, { trigger: 'manual' })).rejects.toMatchObject({ status: 502, code: 'ai_invalid_response' })
    expect(callsTo(calls, 'ai_usage_events', 'update')[0].payload).toMatchObject({ status: 'invalid_response' })
  })

  it('does not finish a recorder it did not start', async () => {
    const { ctx, calls } = world()
    const { ExecutionRecorder } = await import('../../src/services/executions')
    const recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'lead_intake', trigger: 'api' })
    const result = await qualifyLead(ctx, LEAD_ID, { trigger: 'api', recorder })
    expect(result.execution.status).toBe('running')
    expect(recorder.isFinished).toBe(false)
    expect(callsTo(calls, 'workflow_executions', 'update')).toHaveLength(0)
    expect(recorder.steps.map((s) => s.key)).toEqual(['ai_classify', 'notify_slack'])
  })
})

describe('overrideQualification', () => {
  it('inserts a manual qualification, keeps category when not provided and logs the change', async () => {
    const existing = { ...baseLead, score: 40, priority: 'medium' as const, category: 'consulting', qualification_status: 'needs_review' as const }
    const { ctx, calls, getLead } = world({ existingLead: existing })
    const result = await overrideQualification({ ...ctx, actorId: ACTOR_ID }, LEAD_ID, { score: 90, priority: 'high', reason: 'Met them at a conference' })
    expect(callsTo(calls, 'lead_qualifications', 'insert')[0].payload).toMatchObject({
      source: 'manual',
      score: 90,
      priority: 'high',
      category: 'consulting',
      override_reason: 'Met them at a conference',
      created_by: ACTOR_ID,
    })
    expect(getLead()).toMatchObject({ score: 90, priority: 'high', category: 'consulting', qualification_status: 'completed' })
    expect(result.lead.qualificationStatus).toBe('completed')
    const activity = callsTo(calls, 'lead_activities', 'insert')[0].payload
    expect(activity).toMatchObject({
      type: 'qualification_override',
      body: 'Met them at a conference',
      actor_id: ACTOR_ID,
      metadata: { previousScore: 40, previousPriority: 'medium', score: 90, priority: 'high' },
    })
  })
})

describe('processIntake', () => {
  const intake: Intake = {
    name: 'Grace Hopper',
    email: 'grace@navy.example',
    phone: null,
    company: 'Navy Labs',
    jobTitle: null,
    website: 'navy.example/',
    source: 'website_form',
    message: 'Looking for help automating our reporting with AI.',
  }

  it('accepts honeypot submissions without storing anything', async () => {
    const { ctx, calls } = world({ existingLead: null })
    const res = await processIntake(ctx, { ...intake, hp: 'http://spam.example' }, { trigger: 'web_form' })
    expect(res).toEqual({ httpStatus: 202, body: { accepted: true } })
    expect(calls).toHaveLength(0)
  })

  it('creates a new lead, qualifies it and stores the replayable result', async () => {
    const { ctx, calls, getLead } = world({ existingLead: null })
    const res = await processIntake(ctx, intake, { trigger: 'web_form', idempotencyKey: 'form-submission-1' })
    expect(res.httpStatus).toBe(201)
    expect(res.body).toEqual({ leadId: LEAD_ID, executionId: EXECUTION_ID, duplicate: false, qualificationStatus: 'completed', replayed: false })
    expect(callsTo(calls, 'leads', 'insert')[0].payload).toMatchObject({ website: 'https://navy.example', created_by: null, source: 'website_form' })
    expect(getLead()?.score).toBe(78)
    const exec = executionUpdate(calls)
    expect(exec.status).toBe('succeeded')
    expect(exec.result).toEqual(res.body)
    expect((exec.steps as { key: string }[]).map((s) => s.key)).toEqual(['validate', 'deduplicate', 'persist', 'ai_classify', 'notify_slack'])
    expect(callsTo(calls, 'workflow_executions', 'insert')[0].payload).toMatchObject({ idempotency_key: 'form-submission-1', created_by: ACTOR_ID })
  })

  it('updates an existing lead on a duplicate email', async () => {
    const { ctx, calls, getLead } = world({ existingLead: { ...baseLead, email: 'grace@navy.example', email_normalized: 'grace@navy.example' } })
    const res = await processIntake(ctx, intake, { trigger: 'api' })
    expect(res.httpStatus).toBe(200)
    expect(res.body).toMatchObject({ duplicate: true })
    expect(getLead()).toMatchObject({ message: intake.message, submission_count: 2 })
    const types = callsTo(calls, 'lead_activities', 'insert').map((c) => (c.payload as { type: string }).type)
    expect(types[0]).toBe('duplicate_submission')
  })

  it('still succeeds (partial) when AI qualification fails', async () => {
    const { ctx, calls } = world({ existingLead: null, reserve: { allowed: false, reason: 'global_daily_limit' } })
    const res = await processIntake(ctx, intake, { trigger: 'web_form' })
    expect(res.httpStatus).toBe(201)
    expect(res.body).toMatchObject({ qualificationStatus: 'failed' })
    const exec = executionUpdate(calls)
    expect(exec).toMatchObject({ status: 'partial', error_code: 'ai_quota_exceeded' })
    expect(callsTo(calls, 'workflow_executions', 'update')).toHaveLength(1)
  })

  it('skips AI when auto-qualify is off', async () => {
    const { ctx, calls, geminiCalls, getLead } = world({ existingLead: null, aiSettings: { autoQualifyOnIntake: false } })
    const res = await processIntake(ctx, intake, { trigger: 'web_form' })
    expect(res.body).toMatchObject({ qualificationStatus: 'skipped' })
    expect(geminiCalls).toHaveLength(0)
    expect(getLead()?.qualification_status).toBe('skipped')
    expect(executionUpdate(calls).status).toBe('succeeded')
  })

  it('replays a finished idempotent request and rejects one still running', async () => {
    const stored = { leadId: LEAD_ID, executionId: EXECUTION_ID, duplicate: false, qualificationStatus: 'completed', replayed: false }
    const done = world({ idempotentExecution: { id: EXECUTION_ID, status: 'succeeded', result: stored } })
    const res = await processIntake(done.ctx, intake, { trigger: 'api', idempotencyKey: 'abc-12345' })
    expect(res).toEqual({ httpStatus: 200, body: { ...stored, replayed: true } })
    expect(callsTo(done.calls, 'leads')).toHaveLength(0)

    const running = world({ idempotentExecution: { id: EXECUTION_ID, status: 'running', result: null } })
    await expect(processIntake(running.ctx, intake, { trigger: 'api', idempotencyKey: 'abc-12345' })).rejects.toMatchObject({ status: 409 })
  })
})
