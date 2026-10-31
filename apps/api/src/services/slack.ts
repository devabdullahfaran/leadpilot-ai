// STUB — signatures are the contract; implementation pending.
import type { Lead, LeadQualification } from '@leadpilot/shared'
import type { PipelineContext } from './context'
import type { ExecutionRecorder } from './executions'

export interface SlackMessage {
  text: string
  blocks: unknown[]
}

/** Formatted alert: lead name, company, inquiry summary, score, priority, recommended action. */
export function buildLeadAlert(lead: Lead, qualification: Pick<LeadQualification, 'score' | 'priority' | 'summary' | 'recommendedAction' | 'confidence'>, appUrl?: string): SlackMessage {
  void lead; void qualification; void appUrl
  throw new Error('not implemented')
}

export type SlackPostResult = { ok: true } | { ok: false; status: number | null; error: string }

/** POSTs to a Slack incoming webhook with a timeout. Never throws; never logs the URL. */
export async function postToSlack(webhookUrl: string, message: SlackMessage, fetchImpl: typeof fetch, timeoutMs?: number): Promise<SlackPostResult> {
  void webhookUrl; void message; void fetchImpl; void timeoutMs
  throw new Error('not implemented')
}

export type NotifyOutcome = { status: 'sent' } | { status: 'skipped'; reason: string } | { status: 'failed'; error: string }

/**
 * Sends the alert if Slack is configured+enabled and the lead's priority meets minPriority. Records a
 * notification_events row and a lead activity for sent/failed, and the notify_slack step on the recorder.
 * A Slack failure never fails the lead pipeline (execution becomes 'partial').
 */
export async function notifySlackForLead(ctx: PipelineContext, lead: Lead, qualification: LeadQualification, recorder?: ExecutionRecorder): Promise<NotifyOutcome> {
  void ctx; void lead; void qualification; void recorder
  throw new Error('not implemented')
}
