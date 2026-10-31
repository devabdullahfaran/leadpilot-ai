import { SAMPLE_LEADS, materializeSampleData, normalizeEmail } from '@leadpilot/shared'
import { unwrap } from '../lib/errors'
import type { PipelineContext } from './context'

/**
 * Inserts the synthetic sample dataset (is_sample = true) into the workspace. Idempotent: leads whose email
 * already exists in the workspace (sample or not) are skipped together with their history.
 * Uses one read plus one bulk insert per table to stay well under the Worker subrequest limit.
 */
export async function loadSampleData(ctx: PipelineContext): Promise<{ leads: number }> {
  const db = ctx.serviceDb
  const emails = SAMPLE_LEADS.map((l) => normalizeEmail(l.email))
  const existing = unwrap(
    await db.from('leads').select('email_normalized').eq('workspace_id', ctx.workspaceId).in('email_normalized', emails),
    'sample.existing',
  ) as { email_normalized: string }[]
  const taken = new Set(existing.map((r) => r.email_normalized))
  const specs = SAMPLE_LEADS.filter((l) => !taken.has(normalizeEmail(l.email)))
  if (specs.length === 0) return { leads: 0 }

  const data = materializeSampleData(ctx.deps.now(), { workspaceId: ctx.workspaceId, leads: specs })
  // Order matters: children reference leads, qualifications/notifications reference executions.
  unwrap(await db.from('leads').insert(data.leads), 'sample.leads')
  try {
    unwrap(await db.from('workflow_executions').insert(data.executions), 'sample.executions')
    unwrap(await db.from('lead_qualifications').insert(data.qualifications), 'sample.qualifications')
    unwrap(await db.from('lead_activities').insert(data.activities), 'sample.activities')
    if (data.notifications.length > 0) {
      unwrap(await db.from('notification_events').insert(data.notifications), 'sample.notifications')
    }
  } catch (err) {
    // PostgREST cannot span a transaction across requests: remove the half-loaded set so a retry starts clean.
    const leadIds = data.leads.map((l) => l.id)
    await db.from('workflow_executions').delete().eq('workspace_id', ctx.workspaceId).in('id', data.executions.map((e) => e.id))
    await db.from('leads').delete().eq('workspace_id', ctx.workspaceId).in('id', leadIds)
    throw err
  }
  return { leads: data.leads.length }
}

/**
 * Deletes every is_sample row in the workspace. Executions and notifications go first (they only reference
 * leads with ON DELETE SET NULL); deleting the sample leads cascades to their qualifications and activities.
 * AI usage rows are never created for sample data, so there is nothing to remove there.
 */
export async function clearSampleData(ctx: PipelineContext): Promise<{ leads: number }> {
  const db = ctx.serviceDb
  const ws = ctx.workspaceId
  unwrap(await db.from('notification_events').delete().eq('workspace_id', ws).eq('is_sample', true), 'sample.clear_notifications')
  unwrap(await db.from('workflow_executions').delete().eq('workspace_id', ws).eq('is_sample', true), 'sample.clear_executions')
  const { count, error } = await db.from('leads').delete({ count: 'exact' }).eq('workspace_id', ws).eq('is_sample', true)
  if (error) unwrap({ data: null, error }, 'sample.clear_leads')
  return { leads: count ?? 0 }
}
