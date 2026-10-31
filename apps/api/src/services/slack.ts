import type { Lead, LeadPriority, LeadQualification } from '@leadpilot/shared'
import { log } from '../lib/logger'
import type { PipelineContext } from './context'
import { safeErrorMessage, truncateText, type ExecutionRecorder } from './executions'
import { getSlackDelivery } from './settings'

export interface SlackMessage {
  text: string
  blocks: unknown[]
}

export const SLACK_TIMEOUT_MS = 8000

const PRIORITY_RANK: Record<LeadPriority, number> = { high: 3, medium: 2, low: 1 }
const PRIORITY_EMOJI: Record<LeadPriority, string> = {
  high: ':red_circle:',
  medium: ':large_orange_circle:',
  low: ':white_circle:',
}

/** Slack control characters. User content must never be able to inject mentions (<!channel>) or links. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const field = (label: string, value: string) => ({ type: 'mrkdwn', text: `*${label}*\n${truncateText(escapeSlack(value), 1900)}` })

/** Formatted alert: lead name, company, inquiry summary, score, priority, recommended action. */
export function buildLeadAlert(
  lead: Lead,
  qualification: Pick<LeadQualification, 'score' | 'priority' | 'summary' | 'recommendedAction' | 'confidence'>,
  appUrl?: string,
): SlackMessage {
  const priority = qualification.priority
  const header = truncateText(`${PRIORITY_EMOJI[priority]} ${cap(priority)} priority lead: ${escapeSlack(lead.name)}`, 150)
  const context = ['AI-generated estimate']
  if (qualification.confidence !== null) context.push(`confidence ${Math.round(qualification.confidence * 100)}%`)
  if (lead.isSample) context.push('sample data')

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: header, emoji: true } },
    {
      type: 'section',
      fields: [
        field('Lead name', lead.name),
        field('Company', lead.company),
        field('Score', `${qualification.score}/100`),
        field('Priority', cap(priority)),
        field('Recommended action', qualification.recommendedAction ?? 'Not provided'),
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Inquiry summary*\n${truncateText(escapeSlack(qualification.summary ?? 'Not provided'), 2900)}` },
    },
  ]
  if (appUrl) {
    const href = `${appUrl.replace(/\/$/, '')}/leads/${encodeURIComponent(lead.id)}`
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `<${href}|Open lead in LeadPilot>` } })
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: context.join(' · ') }] })

  return {
    text: `${cap(priority)} priority lead: ${escapeSlack(lead.name)} (${escapeSlack(lead.company)}), score ${qualification.score}/100`,
    blocks,
  }
}

export type SlackPostResult = { ok: true } | { ok: false; status: number | null; error: string }

class SlackTimeout extends Error {}

/** POSTs to a Slack incoming webhook with a timeout. Never throws; never logs the URL. */
export async function postToSlack(
  webhookUrl: string,
  message: SlackMessage,
  fetchImpl: typeof fetch,
  timeoutMs: number = SLACK_TIMEOUT_MS,
): Promise<SlackPostResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new SlackTimeout())
    }, timeoutMs)
  })
  const scrub = (text: string) => text.split(webhookUrl).join('[webhook]')
  try {
    const res = await Promise.race([
      fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      }),
      timeout,
    ])
    // Slack answers "ok" on success and a short plain-text code (invalid_token, no_service, …) on failure.
    const body = await Promise.race([res.text(), timeout]).catch((err: unknown) => {
      if (err instanceof SlackTimeout) throw err
      return ''
    })
    if (res.status >= 200 && res.status < 300) return { ok: true }
    const detail = body.trim() ? `: ${truncateText(scrub(body.trim()), 200)}` : ''
    return { ok: false, status: res.status, error: `Slack returned HTTP ${res.status}${detail}` }
  } catch (err) {
    if (err instanceof SlackTimeout || controller.signal.aborted) {
      return { ok: false, status: null, error: `Slack did not respond within ${Math.round(timeoutMs / 100) / 10}s` }
    }
    return { ok: false, status: null, error: 'Could not reach Slack (network error)' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export type NotifyOutcome = { status: 'sent' } | { status: 'skipped'; reason: string } | { status: 'failed'; error: string }

export function meetsMinPriority(priority: LeadPriority, minPriority: LeadPriority): boolean {
  return PRIORITY_RANK[priority] >= PRIORITY_RANK[minPriority]
}

/**
 * Sends the alert if Slack is configured+enabled and the lead's priority meets minPriority. Records a
 * notification_events row and a lead activity for sent/failed, and the notify_slack step on the recorder.
 * A Slack failure never fails the lead pipeline (execution becomes 'partial').
 */
export async function notifySlackForLead(
  ctx: PipelineContext,
  lead: Lead,
  qualification: LeadQualification,
  recorder?: ExecutionRecorder,
): Promise<NotifyOutcome> {
  const started = ctx.deps.now().getTime()
  const elapsed = () => ctx.deps.now().getTime() - started

  let outcome: NotifyOutcome
  let channelLabel: string | null = null
  try {
    const delivery = await getSlackDelivery(ctx)
    if (!delivery.ok) {
      recorder?.record('notify_slack', 'skipped', delivery.reason, elapsed())
      return { status: 'skipped', reason: delivery.reason }
    }
    if (!meetsMinPriority(qualification.priority, delivery.minPriority)) {
      const reason = `Priority ${qualification.priority} is below the Slack threshold (${delivery.minPriority})`
      recorder?.record('notify_slack', 'skipped', reason, elapsed())
      return { status: 'skipped', reason }
    }
    channelLabel = delivery.channelLabel
    const result = await postToSlack(delivery.webhookUrl, buildLeadAlert(lead, qualification), ctx.deps.externalFetch)
    outcome = result.ok ? { status: 'sent' } : { status: 'failed', error: result.error }
  } catch (err) {
    log('error', 'slack_notify_error', { workspaceId: ctx.workspaceId, leadId: lead.id, message: err instanceof Error ? err.message : 'unknown' })
    outcome = { status: 'failed', error: safeErrorMessage(err) }
  }

  const error = outcome.status === 'failed' ? truncateText(outcome.error, 1000) : null
  recorder?.record('notify_slack', outcome.status === 'sent' ? 'succeeded' : 'failed', error ?? 'Slack alert sent', elapsed())

  // Delivery already happened (or failed); bookkeeping errors are logged rather than failing the pipeline.
  const [notification, activity] = await Promise.all([
    ctx.serviceDb.from('notification_events').insert({
      workspace_id: ctx.workspaceId,
      lead_id: lead.id,
      execution_id: recorder?.id ?? null,
      channel: 'slack',
      status: outcome.status === 'sent' ? 'sent' : 'failed',
      error,
      payload: { leadName: lead.name, company: lead.company, score: qualification.score, priority: qualification.priority },
    }),
    ctx.serviceDb.from('lead_activities').insert({
      workspace_id: ctx.workspaceId,
      lead_id: lead.id,
      type: outcome.status === 'sent' ? 'notification_sent' : 'notification_failed',
      body: outcome.status === 'sent' ? 'Slack alert sent' : `Slack alert failed: ${error}`,
      metadata: { channel: 'slack', channelLabel, priority: qualification.priority, executionId: recorder?.id ?? null },
      actor_id: ctx.actorId,
    }),
  ])
  for (const [name, res] of [['notification_events', notification], ['lead_activities', activity]] as const) {
    if (res.error) log('error', 'slack_bookkeeping_failed', { table: name, workspaceId: ctx.workspaceId, code: res.error.code, message: res.error.message })
  }
  return outcome
}
