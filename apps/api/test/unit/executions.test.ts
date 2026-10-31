import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/lib/errors'
import type { ExecutionRow } from '../../src/lib/mappers'
import { ExecutionRecorder } from '../../src/services/executions'
import { ACTOR_ID, createFakeDb, testContext, WORKSPACE_ID, type FakeCall } from './helpers/fake-db'

const EXECUTION_ID = '55555555-5555-4555-8555-555555555555'
const LEAD_ID = '66666666-6666-4666-8666-666666666666'

/** Fake clock that advances by `step` ms on every read. */
function clock(start = Date.parse('2026-10-31T10:00:00.000Z'), step = 10) {
  let t = start - step
  return () => new Date((t += step))
}

function executionRowFrom(update: Record<string, unknown>): ExecutionRow {
  return {
    id: EXECUTION_ID,
    workspace_id: WORKSPACE_ID,
    lead_id: (update.lead_id as string) ?? null,
    workflow_key: 'lead_qualification',
    engine: 'worker',
    trigger: 'manual',
    status: update.status as ExecutionRow['status'],
    steps: update.steps as ExecutionRow['steps'],
    attempt: 1,
    retry_of_id: null,
    error_code: update.error_code as string | null,
    error_message: update.error_message as string | null,
    idempotency_key: null,
    result: update.result ?? null,
    started_at: '2026-10-31T10:00:00.000Z',
    finished_at: update.finished_at as string,
    duration_ms: update.duration_ms as number,
    created_by: ACTOR_ID,
    is_sample: false,
    lead: { name: 'Ada' },
  }
}

function setup(handler?: (call: FakeCall) => { data: unknown; error: { code?: string; message: string } | null } | undefined) {
  const { db, calls } = createFakeDb(
    handler ??
      ((call) => {
        if (call.op === 'insert') return { data: { id: EXECUTION_ID }, error: null }
        if (call.op === 'update') return { data: executionRowFrom(call.payload as Record<string, unknown>), error: null }
        return undefined
      }),
  )
  return { ctx: testContext(db, { now: clock() }), calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ExecutionRecorder', () => {
  it('start() inserts a running row scoped to the workspace and actor', async () => {
    const { ctx, calls } = setup()
    const recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'lead_intake', trigger: 'api', idempotencyKey: 'abc12345' })
    expect(recorder.id).toBe(EXECUTION_ID)
    expect(calls[0]).toMatchObject({ table: 'workflow_executions', op: 'insert' })
    expect(calls[0].payload).toMatchObject({
      workspace_id: WORKSPACE_ID,
      created_by: ACTOR_ID,
      workflow_key: 'lead_intake',
      engine: 'worker',
      trigger: 'api',
      status: 'running',
      steps: [],
      attempt: 1,
      idempotency_key: 'abc12345',
      started_at: '2026-10-31T10:00:00.000Z',
    })
  })

  it('start() maps an idempotency-key collision to 409 conflict', async () => {
    const { ctx } = setup(() => ({ data: null, error: { code: '23505', message: 'duplicate key' } }))
    await expect(ExecutionRecorder.start(ctx, { workflowKey: 'lead_intake', trigger: 'api', idempotencyKey: 'abc12345' })).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    })
  })

  it('step() records timing, attempts and messages, and re-throws failures with a safe message', async () => {
    const { ctx } = setup()
    const recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'lead_qualification', trigger: 'manual' })

    const value = await recorder.step('validate', async () => 42, { attempts: () => 2, message: (r) => `value ${r}` })
    expect(value).toBe(42)
    await expect(
      recorder.step('persist', async () => {
        throw new Error('connection reset by 10.0.0.5')
      }),
    ).rejects.toThrow('connection reset')
    await expect(
      recorder.step('ai_classify', async () => {
        throw new ApiError(502, 'ai_unavailable', 'Gemini is unavailable')
      }),
    ).rejects.toBeInstanceOf(ApiError)
    recorder.record('notify_slack', 'skipped', 'Slack is not configured')

    expect(recorder.steps).toEqual([
      { key: 'validate', status: 'succeeded', startedAt: expect.any(String), durationMs: 10, attempts: 2, message: 'value 42' },
      // Internal error details are not persisted into the user-visible step list.
      { key: 'persist', status: 'failed', startedAt: expect.any(String), durationMs: 10, message: 'Unexpected internal error' },
      { key: 'ai_classify', status: 'failed', startedAt: expect.any(String), durationMs: 10, message: 'Gemini is unavailable' },
      { key: 'notify_slack', status: 'skipped', startedAt: expect.any(String), durationMs: 0, message: 'Slack is not configured' },
    ])
    expect(recorder.hasFailedSteps()).toBe(true)
  })

  it('finish() persists status, steps, timing, truncated errors, result and lead, and maps the row', async () => {
    const { ctx, calls } = setup()
    const recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'lead_qualification', trigger: 'manual' })
    recorder.record('ai_classify', 'failed', 'boom')
    recorder.setLead(LEAD_ID)
    const execution = await recorder.finish('failed', { code: 'x'.repeat(80), message: 'm'.repeat(2500) }, { leadId: LEAD_ID })

    const update = calls.find((c) => c.op === 'update')!
    expect(update.filters).toEqual([
      ['id', EXECUTION_ID],
      ['workspace_id', WORKSPACE_ID],
    ])
    const patch = update.payload as Record<string, unknown>
    expect(patch.status).toBe('failed')
    expect(patch.lead_id).toBe(LEAD_ID)
    expect(patch.result).toEqual({ leadId: LEAD_ID })
    expect((patch.error_code as string).length).toBe(60)
    expect((patch.error_message as string).length).toBe(2000)
    expect(patch.duration_ms).toBeGreaterThan(0)
    expect(Date.parse(patch.finished_at as string)).toBeGreaterThan(Date.parse('2026-10-31T10:00:00.000Z'))
    expect(patch.steps).toHaveLength(1)

    expect(execution).toMatchObject({ id: EXECUTION_ID, status: 'failed', leadId: LEAD_ID, leadName: 'Ada', steps: patch.steps })
    expect(recorder.isFinished).toBe(true)
    // A second finish returns the stored result without writing again.
    await recorder.finish('succeeded')
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1)
  })

  it('finish() logs the pipeline error and throws internal_error when the update fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = setup((call) =>
      call.op === 'insert' ? { data: { id: EXECUTION_ID }, error: null } : { data: null, error: { code: '08006', message: 'connection failure' } },
    )
    const recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'lead_qualification', trigger: 'manual' })
    await expect(recorder.finish('failed', { code: 'ai_unavailable', message: 'Gemini down' })).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
    })
    const logged = errorLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('execution_finish_failed')
    expect(logged).toContain('ai_unavailable')
    expect(logged).toContain('Gemini down')
  })

  it('snapshot() reflects in-memory state while running', async () => {
    const { ctx } = setup()
    const recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'lead_intake', trigger: 'web_form', attempt: 2 })
    recorder.record('validate', 'succeeded')
    expect(recorder.snapshot()).toMatchObject({ id: EXECUTION_ID, status: 'running', attempt: 2, steps: [{ key: 'validate' }], finishedAt: null })
  })
})
