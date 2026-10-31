import {
  PROMPT_VERSION,
  qualificationOutcome,
  reconcileScore,
  type AiSettings,
  type AiUsageStatus,
  type Lead,
  type LeadQualification,
  type QualificationOverride,
  type QualificationStatus,
  type QualifyResult,
  type WorkflowTrigger,
} from '@leadpilot/shared'
import type { Db } from '../lib/db'
import { ApiError, notFound } from '../lib/errors'
import { log } from '../lib/logger'
import { LEAD_SELECT, mapLead, mapQualification, QUALIFICATION_SELECT, type LeadRow, type QualificationRow } from '../lib/mappers'
import type { PipelineContext } from './context'
import { ExecutionRecorder, safeErrorMessage, truncateText, unwrapAs } from './executions'
import { qualifyWithGemini, type GeminiOutcome } from './gemini'
import { getAiSettings } from './settings'
import { notifySlackForLead } from './slack'

export interface QualifyOptions {
  trigger: WorkflowTrigger
  attempt?: number
  retryOfId?: string | null
  /** When called from intake, the intake execution is reused instead of starting a new one. */
  recorder?: ExecutionRecorder
  /** Already-loaded workspace AI settings (saves a query when the caller has them). */
  settings?: AiSettings
}

interface ReserveRow {
  reservation_id: string | null
  allowed: boolean
  reason: string | null
  workspace_used: number
  global_used: number
}

const QUALIFICATION_ERROR_MAX = 1000

async function loadLead(db: Db, workspaceId: string, leadId: string): Promise<LeadRow> {
  const row = unwrapAs<LeadRow | null>(
    await db.from('leads').select(LEAD_SELECT).eq('workspace_id', workspaceId).eq('id', leadId).maybeSingle(),
    'qualification.load_lead',
  )
  if (!row) throw notFound('Lead')
  return row
}

async function updateLead(ctx: PipelineContext, leadId: string, patch: Record<string, unknown>, context: string): Promise<LeadRow> {
  return unwrapAs<LeadRow>(
    await ctx.serviceDb.from('leads').update(patch).eq('workspace_id', ctx.workspaceId).eq('id', leadId).select(LEAD_SELECT).single(),
    context,
  )
}

async function addActivity(
  ctx: PipelineContext,
  leadId: string,
  type: string,
  body: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  unwrapAs<null>(
    await ctx.serviceDb.from('lead_activities').insert({
      workspace_id: ctx.workspaceId,
      lead_id: leadId,
      type,
      body: body === null ? null : truncateText(body, 4000),
      metadata,
      actor_id: ctx.actorId,
    }),
    `qualification.activity.${type}`,
  )
}

/** Seconds until the daily quota window (UTC midnight) resets. */
function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

function usageStatusFor(outcome: GeminiOutcome): AiUsageStatus {
  if (outcome.ok) return 'success'
  if (outcome.code === 'invalid_response' || outcome.code === 'blocked') return 'invalid_response'
  if (outcome.code === 'timeout') return 'timeout'
  return 'error'
}

function apiErrorForGemini(outcome: Extract<GeminiOutcome, { ok: false }>): ApiError {
  switch (outcome.code) {
    case 'rate_limited':
      return new ApiError(429, 'ai_quota_exceeded', `The AI provider's quota or rate limit was reached. ${outcome.message}`, {
        reason: 'provider_rate_limited',
      })
    case 'invalid_response':
    case 'blocked':
      return new ApiError(502, 'ai_invalid_response', outcome.message)
    default:
      return new ApiError(502, 'ai_unavailable', outcome.message)
  }
}

/**
 * AI qualification pipeline for one lead: checks the global kill switch, workspace setting and API key,
 * reserves quota (reserve_ai_call), calls Gemini, validates + reconciles the output, persists the
 * qualification + lead fields + activity, sends Slack when warranted and records the execution.
 *
 * Failures are recorded (execution 'failed', lead qualification_status 'failed', usage row finalized) and
 * then thrown as ApiError: ai_disabled/ai_not_configured (503), ai_quota_exceeded (429),
 * ai_unavailable/ai_invalid_response (502), not_found (404). Never fabricates a result.
 *
 * When `options.recorder` is provided the caller owns it: steps are recorded but finish() is left to the caller.
 */
export async function qualifyLead(ctx: PipelineContext, leadId: string, options: QualifyOptions): Promise<QualifyResult> {
  const db = ctx.serviceDb
  const leadRow = await loadLead(db, ctx.workspaceId, leadId)
  const ownsRecorder = !options.recorder
  const recorder =
    options.recorder ??
    (await ExecutionRecorder.start(ctx, {
      workflowKey: 'lead_qualification',
      trigger: options.trigger,
      leadId,
      attempt: options.attempt,
      retryOfId: options.retryOfId,
    }))
  recorder.setLead(leadId)
  const model = ctx.config.gemini.model

  // Tracks what has been written so an unexpected error can still be recorded consistently.
  let reservationId: string | null = null
  let usageFinalized = false
  let persisted = false

  const finishFailed = async (code: string, message: string) => {
    if (!ownsRecorder) return
    try {
      await recorder.finish('failed', { code, message })
    } catch {
      // finish() already logged the persistence failure together with this pipeline error.
    }
  }

  // Errors that were fully recorded before being thrown; anything else is handled as unexpected below.
  let handled: ApiError | null = null

  /** Guard failure: record the step and lead state, finish the execution, return the error to throw. */
  const rejectWith = async (stepStatus: 'skipped' | 'failed', leadStatus: QualificationStatus, error: ApiError): Promise<ApiError> => {
    recorder.record('ai_classify', stepStatus, error.message)
    try {
      await updateLead(ctx, leadId, { qualification_status: leadStatus, qualification_error: truncateText(error.message, QUALIFICATION_ERROR_MAX) }, 'qualification.guard')
    } catch (err) {
      log('error', 'qualification_guard_update_failed', { leadId, message: safeErrorMessage(err) })
    }
    await finishFailed(error.code, error.message)
    handled = error
    return error
  }

  try {
    const settings = options.settings ?? (await getAiSettings(db, ctx.workspaceId))

    if (!ctx.config.ai.enabled) {
      await recordRejectedUsage(ctx, leadId, model, 'ai_disabled')
      throw await rejectWith('skipped', 'skipped', new ApiError(503, 'ai_disabled', 'AI qualification is disabled on this server (AI_ENABLED=false)'))
    }
    if (!settings.enabled) {
      await recordRejectedUsage(ctx, leadId, model, 'ai_disabled')
      throw await rejectWith('skipped', 'skipped', new ApiError(503, 'ai_disabled', 'AI qualification is disabled in this workspace\'s settings'))
    }
    const apiKey = ctx.config.gemini.apiKey
    if (!apiKey) {
      await recordRejectedUsage(ctx, leadId, model, 'ai_not_configured')
      throw await rejectWith('skipped', 'skipped', new ApiError(503, 'ai_not_configured', 'AI qualification is not configured: GEMINI_API_KEY is not set on the server'))
    }

    const reservation = unwrapAs<ReserveRow[] | null>(
      await db
        .rpc('reserve_ai_call', {
          p_workspace_id: ctx.workspaceId,
          p_user_id: ctx.actorId,
          p_lead_id: leadId,
          p_model: model,
          p_workspace_limit: ctx.config.ai.dailyLimitPerWorkspace,
          p_global_limit: ctx.config.ai.dailyLimitGlobal,
        }),
      'qualification.reserve',
    )?.[0]
    if (!reservation) throw new ApiError(500, 'internal_error', 'AI quota reservation returned no result')
    if (!reservation.allowed || !reservation.reservation_id) {
      const scope = reservation.reason === 'global_daily_limit' ? 'The daily AI limit for this demo server' : 'This workspace\'s daily AI limit'
      throw await rejectWith(
        'failed',
        'failed',
        new ApiError(429, 'ai_quota_exceeded', `${scope} has been reached. It resets at 00:00 UTC.`, {
          reason: reservation.reason,
          workspaceUsed: reservation.workspace_used,
          globalUsed: reservation.global_used,
          retryAfterSeconds: secondsUntilUtcMidnight(ctx.deps.now()),
        }),
      )
    }
    reservationId = reservation.reservation_id

    await updateLead(ctx, leadId, { qualification_status: 'processing', qualification_error: null }, 'qualification.processing')
    await addActivity(ctx, leadId, 'qualification_started', null, { model, trigger: options.trigger, executionId: recorder.id })

    const outcome = await qualifyWithGemini(
      {
        lead: {
          email: leadRow.email,
          company: leadRow.company,
          jobTitle: leadRow.job_title,
          website: leadRow.website,
          source: leadRow.source,
          message: leadRow.message,
        },
        settings,
      },
      { apiKey, model, timeoutMs: ctx.config.gemini.timeoutMs, fetch: ctx.deps.externalFetch },
    )

    const usage = await db
      .from('ai_usage_events')
      .update({
        status: usageStatusFor(outcome),
        latency_ms: outcome.latencyMs,
        prompt_tokens: outcome.usage?.promptTokens ?? null,
        output_tokens: outcome.usage?.outputTokens ?? null,
        error_code: outcome.ok ? null : outcome.code,
      })
      .eq('id', reservationId)
      .eq('workspace_id', ctx.workspaceId)
    usageFinalized = true
    if (usage.error) log('error', 'ai_usage_finalize_failed', { reservationId, code: usage.error.code, message: usage.error.message })

    if (!outcome.ok) {
      recorder.record('ai_classify', 'failed', outcome.message, outcome.latencyMs, outcome.attempts)
      const error = apiErrorForGemini(outcome)
      await updateLead(
        ctx,
        leadId,
        { qualification_status: 'failed', qualification_error: truncateText(error.message, QUALIFICATION_ERROR_MAX) },
        'qualification.failed',
      )
      await addActivity(ctx, leadId, 'qualification_failed', error.message, {
        code: outcome.code,
        model,
        attempts: outcome.attempts,
        executionId: recorder.id,
      })
      await finishFailed(error.code, error.message)
      handled = error
      throw error
    }

    const o = outcome.output
    const reconciled = reconcileScore(o.score, o.criteria, settings.criteria, settings.thresholds, o.priority, o.category)
    const status = qualificationOutcome(o.confidence, o.category, settings.reviewConfidence)
    const confidence = Math.round(o.confidence * 1000) / 1000
    recorder.record(
      'ai_classify',
      'succeeded',
      `Score ${reconciled.score} (${reconciled.priority}), category ${o.category}${status === 'needs_review' ? ', flagged for review' : ''}`,
      outcome.latencyMs,
      outcome.attempts,
    )

    const persist = async () => {
      const qualificationRow = unwrapAs<QualificationRow>(
        await db
          .from('lead_qualifications')
          .insert({
            workspace_id: ctx.workspaceId,
            lead_id: leadId,
            source: 'ai',
            score: reconciled.score,
            priority: reconciled.priority,
            category: o.category,
            summary: o.summary,
            reasoning: o.reasoning,
            recommended_action: o.recommendedAction,
            confidence,
            criteria: o.criteria,
            adjustments: reconciled.adjustments,
            model: outcome.model,
            prompt_version: PROMPT_VERSION,
            execution_id: recorder.id,
          })
          .select(QUALIFICATION_SELECT)
          .single(),
        'qualification.insert',
      )
      const updated = await updateLead(
        ctx,
        leadId,
        {
          score: reconciled.score,
          priority: reconciled.priority,
          category: o.category,
          ai_summary: o.summary,
          ai_reasoning: o.reasoning,
          recommended_action: o.recommendedAction,
          confidence,
          qualification_status: status,
          qualification_error: null,
          last_qualified_at: ctx.deps.now().toISOString(),
        },
        'qualification.update_lead',
      )
      await addActivity(ctx, leadId, 'qualification_completed', o.summary, {
        score: reconciled.score,
        priority: reconciled.priority,
        category: o.category,
        status,
        model: outcome.model,
        executionId: recorder.id,
      })
      return { qualification: mapQualification(qualificationRow), lead: mapLead(updated) }
    }
    const saved = ownsRecorder
      ? await recorder.step('persist', persist, { message: () => 'Saved qualification and lead fields' })
      : await persist()
    persisted = true

    const notify = await notifySlackForLead(ctx, saved.lead, saved.qualification, recorder)

    let execution = recorder.snapshot()
    if (ownsRecorder) {
      execution =
        notify.status === 'failed'
          ? await recorder.finish('partial', { code: 'integration_failed', message: `Slack notification failed: ${notify.error}` })
          : await recorder.finish('succeeded')
    }
    return { lead: saved.lead, qualification: saved.qualification, execution }
  } catch (err) {
    // After the qualification is persisted only finish() can fail, and it has already logged the details.
    if (err === handled || recorder.isFinished || persisted) throw err
    const message = safeErrorMessage(err)
    log('error', 'qualification_unexpected_error', { leadId, executionId: recorder.id, message: err instanceof Error ? err.message : String(err) })
    if (!recorder.steps.some((s) => s.key === 'ai_classify')) recorder.record('ai_classify', 'failed', message)
    else if (!recorder.hasFailedSteps()) recorder.record('persist', 'failed', message)
    if (reservationId && !usageFinalized) {
      await db.from('ai_usage_events').update({ status: 'error', error_code: 'internal_error' }).eq('id', reservationId)
    }
    if (reservationId) {
      try {
        await updateLead(ctx, leadId, { qualification_status: 'failed', qualification_error: message }, 'qualification.unexpected')
      } catch {
        // Already logged by unwrap/fromPostgrest.
      }
    }
    const code = err instanceof ApiError ? err.code : 'internal_error'
    await finishFailed(code, message)
    throw err instanceof ApiError ? err : new ApiError(500, 'internal_error', message)
  }
}

/** Records an AI call that was refused before reaching the provider (shown in the integrations usage log). */
async function recordRejectedUsage(ctx: PipelineContext, leadId: string, model: string, code: 'ai_disabled' | 'ai_not_configured') {
  const { error } = await ctx.serviceDb.from('ai_usage_events').insert({
    workspace_id: ctx.workspaceId,
    user_id: ctx.actorId,
    lead_id: leadId,
    model,
    status: 'rejected_disabled',
    error_code: code,
  })
  if (error) log('error', 'ai_usage_reject_insert_failed', { code: error.code, message: error.message })
}

/** Manual override by a member: new 'manual' qualification row, lead fields updated, activity logged. */
export async function overrideQualification(
  ctx: PipelineContext & { actorId: string },
  leadId: string,
  input: QualificationOverride,
): Promise<{ lead: Lead; qualification: LeadQualification }> {
  const db = ctx.serviceDb
  const before = await loadLead(db, ctx.workspaceId, leadId)
  const category = input.category ?? before.category
  const qualificationRow = unwrapAs<QualificationRow>(
    await db
      .from('lead_qualifications')
      .insert({
        workspace_id: ctx.workspaceId,
        lead_id: leadId,
        source: 'manual',
        score: input.score,
        priority: input.priority,
        category,
        criteria: [],
        adjustments: [],
        override_reason: input.reason,
        created_by: ctx.actorId,
      })
      .select(QUALIFICATION_SELECT)
      .single(),
    'qualification.override_insert',
  )
  const updated = await updateLead(
    ctx,
    leadId,
    {
      score: input.score,
      priority: input.priority,
      category,
      qualification_status: 'completed',
      qualification_error: null,
      last_qualified_at: ctx.deps.now().toISOString(),
    },
    'qualification.override_update',
  )
  await addActivity(ctx, leadId, 'qualification_override', input.reason, {
    previousScore: before.score,
    previousPriority: before.priority,
    previousCategory: before.category,
    score: input.score,
    priority: input.priority,
    category,
  })
  return { lead: mapLead(updated), qualification: mapQualification(qualificationRow) }
}
