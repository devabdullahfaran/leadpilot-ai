// STUB — signatures are the contract; implementation pending.
import type { Intake, IntakeResult } from '@leadpilot/shared'
import type { PipelineContext } from './context'

export interface IntakeOptions {
  trigger: 'web_form' | 'api' | 'n8n_webhook'
  idempotencyKey?: string | null
}

/**
 * Webhook lead intake: validate → deduplicate (same normalized email in the workspace updates the existing
 * lead, increments submission_count and logs duplicate_submission) → persist → optionally AI-qualify
 * (workspace autoQualifyOnIntake) → Slack. Idempotent per (workspace, idempotency key): a repeated key
 * replays the stored result with replayed=true. Honeypot submissions are accepted (202) but not stored.
 */
export async function processIntake(ctx: PipelineContext, input: Intake, options: IntakeOptions): Promise<{ httpStatus: 200 | 201 | 202; body: IntakeResult | { accepted: true } }> {
  void ctx; void input; void options
  throw new Error('not implemented')
}
