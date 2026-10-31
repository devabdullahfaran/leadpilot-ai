// STUB — signatures are the contract; implementation pending.
import type { Lead, LeadQualification, QualificationOverride, QualifyResult, WorkflowTrigger } from '@leadpilot/shared'
import type { PipelineContext } from './context'
import type { ExecutionRecorder } from './executions'

export interface QualifyOptions {
  trigger: WorkflowTrigger
  attempt?: number
  retryOfId?: string | null
  /** When called from intake, the intake execution is reused instead of starting a new one. */
  recorder?: ExecutionRecorder
}

/**
 * AI qualification pipeline for one lead: checks the global kill switch, workspace setting and API key,
 * reserves quota (reserve_ai_call), calls Gemini, validates + reconciles the output, persists the
 * qualification + lead fields + activity, sends Slack when warranted and records the execution.
 *
 * Failures are recorded (execution 'failed', lead qualification_status 'failed', usage row finalized) and
 * then thrown as ApiError: ai_disabled/ai_not_configured (503), ai_quota_exceeded (429),
 * ai_unavailable/ai_invalid_response (502), not_found (404). Never fabricates a result.
 */
export async function qualifyLead(ctx: PipelineContext, leadId: string, options: QualifyOptions): Promise<QualifyResult> {
  void ctx; void leadId; void options
  throw new Error('not implemented')
}

/** Manual override by a member: new 'manual' qualification row, lead fields updated, activity logged. */
export async function overrideQualification(ctx: PipelineContext & { actorId: string }, leadId: string, input: QualificationOverride): Promise<{ lead: Lead; qualification: LeadQualification }> {
  void ctx; void leadId; void input
  throw new Error('not implemented')
}
