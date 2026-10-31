import { normalizeEmail, normalizeWebsite, type Intake, type IntakeResult, type QualificationStatus } from '@leadpilot/shared'
import { ApiError, badRequest, conflict, fromPostgrest } from '../lib/errors'
import { log } from '../lib/logger'
import type { ExecutionRow } from '../lib/mappers'
import type { PipelineContext } from './context'
import { ExecutionRecorder, safeErrorMessage, truncateText, unwrapAs } from './executions'
import { qualifyLead } from './qualification'
import { getAiSettings } from './settings'

export interface IntakeOptions {
  trigger: 'web_form' | 'api' | 'n8n_webhook'
  idempotencyKey?: string | null
}

type IntakeResponse = { httpStatus: 200 | 201 | 202; body: IntakeResult | { accepted: true } }

interface ExistingLead {
  id: string
  submission_count: number
}

async function findByEmail(ctx: PipelineContext, email: string): Promise<ExistingLead | null> {
  return unwrapAs<ExistingLead | null>(
    await ctx.serviceDb
      .from('leads')
      .select('id, submission_count')
      .eq('workspace_id', ctx.workspaceId)
      .eq('email_normalized', normalizeEmail(email))
      .maybeSingle(),
    'intake.deduplicate',
  )
}

async function addActivity(ctx: PipelineContext, leadId: string, type: string, body: string, metadata: Record<string, unknown>) {
  unwrapAs<null>(
    await ctx.serviceDb.from('lead_activities').insert({
      workspace_id: ctx.workspaceId,
      lead_id: leadId,
      type,
      body,
      metadata,
      actor_id: null,
    }),
    `intake.activity.${type}`,
  )
}

/** Replays a finished execution's stored response, or rejects a key that is in flight / never produced one. */
async function replay(ctx: PipelineContext, key: string): Promise<IntakeResponse | null> {
  const row = unwrapAs<Pick<ExecutionRow, 'id' | 'status' | 'result'> | null>(
    await ctx.serviceDb
      .from('workflow_executions')
      .select('id, status, result')
      .eq('workspace_id', ctx.workspaceId)
      .eq('idempotency_key', key)
      .maybeSingle(),
    'intake.idempotency',
  )
  if (!row) return null
  if (row.status === 'running') {
    throw conflict('A request with this Idempotency-Key is still being processed', { executionId: row.id })
  }
  const result = row.result as IntakeResult | null
  if (!result || typeof result !== 'object' || !('leadId' in result)) {
    throw conflict('A previous request with this Idempotency-Key failed. Retry with a new key.', { executionId: row.id })
  }
  return { httpStatus: 200, body: { ...result, replayed: true } }
}

/**
 * Webhook lead intake: validate → deduplicate (same normalized email in the workspace updates the existing
 * lead, increments submission_count and logs duplicate_submission) → persist → optionally AI-qualify
 * (workspace autoQualifyOnIntake) → Slack. Idempotent per (workspace, idempotency key): a repeated key
 * replays the stored result with replayed=true. Honeypot submissions are accepted (202) but not stored.
 *
 * The idempotency key falls back to the body's submissionId when no header value is passed.
 */
export async function processIntake(ctx: PipelineContext, input: Intake, options: IntakeOptions): Promise<IntakeResponse> {
  if (input.hp && input.hp.trim()) {
    log('info', 'intake_honeypot', { workspaceId: ctx.workspaceId, trigger: options.trigger })
    return { httpStatus: 202, body: { accepted: true } }
  }

  const idempotencyKey = (options.idempotencyKey ?? input.submissionId ?? '').trim() || null
  if (idempotencyKey) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw badRequest('Idempotency-Key must be between 8 and 200 characters')
    }
    const replayed = await replay(ctx, idempotencyKey)
    if (replayed) return replayed
  }

  let recorder: ExecutionRecorder
  try {
    recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'lead_intake', trigger: options.trigger, idempotencyKey })
  } catch (err) {
    // Lost a race with an identical request: replay it if it already finished.
    if (idempotencyKey && err instanceof ApiError && err.code === 'conflict') {
      const replayed = await replay(ctx, idempotencyKey)
      if (replayed) return replayed
    }
    throw err
  }

  try {
    const website = await recorder.step(
      'validate',
      async () => {
        if (!input.website) return { value: null, note: 'Submission is valid' }
        const normalized = normalizeWebsite(input.website)
        return normalized
          ? { value: normalized, note: 'Submission is valid' }
          : { value: input.website, note: 'Submission is valid; website kept as entered (not a parseable URL)' }
      },
      { message: (r) => r.note },
    )

    const existing = await recorder.step('deduplicate', () => findByEmail(ctx, input.email), {
      message: (r) => (r ? 'Matched existing lead' : 'New lead'),
    })

    const persisted = await recorder.step(
      'persist',
      async (): Promise<{ leadId: string; duplicate: boolean; submissionCount: number }> => {
        let match = existing
        if (!match) {
          const { data, error } = await ctx.serviceDb
            .from('leads')
            .insert({
              workspace_id: ctx.workspaceId,
              name: input.name,
              email: input.email,
              phone: input.phone ?? null,
              company: input.company,
              job_title: input.jobTitle ?? null,
              website: website.value,
              source: input.source,
              message: input.message,
              status: 'new',
              created_by: null,
            })
            .select('id')
            .single()
          if (!error) {
            const leadId = (data as { id: string }).id
            await addActivity(ctx, leadId, 'lead_created', `Received via ${options.trigger.replace('_', ' ')}`, {
              source: input.source,
              trigger: options.trigger,
              executionId: recorder.id,
            })
            return { leadId, duplicate: false, submissionCount: 1 }
          }
          // A concurrent submission with the same email won the insert: treat this one as a duplicate.
          if (error.code !== '23505') throw fromPostgrest(error, 'intake.insert')
          match = await findByEmail(ctx, input.email)
          if (!match) throw fromPostgrest(error, 'intake.insert')
        }
        const submissionCount = match.submission_count + 1
        unwrapAs<null>(
          await ctx.serviceDb
            .from('leads')
            .update({ message: input.message, submission_count: submissionCount })
            .eq('workspace_id', ctx.workspaceId)
            .eq('id', match.id),
          'intake.update_duplicate',
        )
        await addActivity(ctx, match.id, 'duplicate_submission', 'Repeat submission received; the inquiry message was updated to the latest one.', {
          submissionCount,
          source: input.source,
          trigger: options.trigger,
          executionId: recorder.id,
        })
        return { leadId: match.id, duplicate: true, submissionCount }
      },
      { message: (r) => (r.duplicate ? `Updated existing lead (submission #${r.submissionCount})` : 'Created lead') },
    )
    recorder.setLead(persisted.leadId)

    const settings = await getAiSettings(ctx.serviceDb, ctx.workspaceId)
    let qualificationStatus: QualificationStatus
    let aiError: ApiError | null = null
    if (settings.enabled && settings.autoQualifyOnIntake) {
      try {
        const result = await qualifyLead(ctx, persisted.leadId, { trigger: options.trigger, recorder, settings })
        qualificationStatus = result.lead.qualificationStatus
      } catch (err) {
        // Intake still succeeds: the lead is stored and the AI failure is recorded on the lead and execution.
        aiError = err instanceof ApiError ? err : new ApiError(500, 'internal_error', safeErrorMessage(err))
        qualificationStatus = aiError.code === 'ai_disabled' || aiError.code === 'ai_not_configured' ? 'skipped' : 'failed'
        if (!recorder.steps.some((s) => s.key === 'notify_slack')) {
          recorder.record('notify_slack', 'skipped', 'Lead was not qualified')
        }
      }
    } else {
      const reason = settings.enabled
        ? 'Auto-qualification on intake is turned off for this workspace'
        : 'AI qualification is disabled for this workspace'
      recorder.record('ai_classify', 'skipped', reason)
      recorder.record('notify_slack', 'skipped', 'Lead was not qualified')
      unwrapAs<null>(
        await ctx.serviceDb
          .from('leads')
          .update({ qualification_status: 'skipped', qualification_error: reason })
          .eq('workspace_id', ctx.workspaceId)
          .eq('id', persisted.leadId),
        'intake.skip_ai',
      )
      qualificationStatus = 'skipped'
    }

    const body: IntakeResult = {
      leadId: persisted.leadId,
      executionId: recorder.id,
      duplicate: persisted.duplicate,
      qualificationStatus,
      replayed: false,
    }
    const failedStep = recorder.steps.find((s) => s.status === 'failed')
    if (failedStep) {
      const code = aiError?.code ?? (failedStep.key === 'notify_slack' ? 'integration_failed' : 'internal_error')
      const message = aiError?.message ?? `${failedStep.key} failed: ${failedStep.message ?? 'unknown error'}`
      await recorder.finish('partial', { code, message: truncateText(message, 2000) }, body)
    } else {
      await recorder.finish('succeeded', null, body)
    }
    return { httpStatus: persisted.duplicate ? 200 : 201, body }
  } catch (err) {
    if (!recorder.isFinished) {
      const code = err instanceof ApiError ? err.code : 'internal_error'
      try {
        await recorder.finish('failed', { code, message: safeErrorMessage(err) })
      } catch {
        // finish() logged the persistence failure; the original error below is what the caller sees.
      }
    }
    throw err
  }
}
