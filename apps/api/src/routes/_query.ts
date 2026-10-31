import { fromPostgrest, type PostgrestErrorLike } from '../lib/errors'
import { log } from '../lib/logger'
import type { Db } from '../lib/db'

/** Escapes LIKE metacharacters so user text is matched literally (backslash is the default LIKE escape). */
export function likeLiteral(value: string): string {
  // PostgREST turns `*` into `%`; map it to the single-character wildcard so "a*b" still matches itself.
  return value.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/\*/g, '_')
}

/**
 * Double-quotes a value for PostgREST logic trees (`or=(...)`), so commas, dots, colons and parentheses
 * in user input cannot change the filter structure.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, (m) => `\\${m}`)}"`
}

/** Start of the current UTC day (quota counters reset at UTC midnight, matching reserve_ai_call). */
export function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

interface PageResult<T> {
  data: T[] | null
  error: PostgrestErrorLike | null
  count: number | null
}

/**
 * Unwraps a `{ count: 'exact' }` + `.range()` result. PostgREST answers a page past the end with
 * PGRST103 (416); that is an empty page, so the total is fetched with a head-only count instead.
 */
export async function unwrapPage<T>(
  result: PageResult<T>,
  countOnly: () => PromiseLike<{ count: number | null; error: PostgrestErrorLike | null }>,
  context: string,
): Promise<{ rows: T[]; total: number }> {
  if (result.error?.code === 'PGRST103') {
    const head = await countOnly()
    if (head.error) throw fromPostgrest(head.error, `${context}.count`)
    return { rows: [], total: head.count ?? 0 }
  }
  if (result.error) throw fromPostgrest(result.error, context)
  return { rows: result.data ?? [], total: result.count ?? 0 }
}

export interface ActivityInsert {
  lead_id: string
  type: string
  body?: string | null
  metadata?: Record<string, unknown>
  actor_id: string | null
}

/**
 * System activity log written with the service client after the user-level write succeeded. A logging
 * failure is reported in the logs but does not turn a completed write into an error response.
 */
export async function logActivities(serviceDb: Db, workspaceId: string, rows: ActivityInsert[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await serviceDb
    .from('lead_activities')
    .insert(rows.map((r) => ({ workspace_id: workspaceId, metadata: {}, ...r })))
  if (error) log('error', 'activity_log_failed', { workspaceId, code: error.code, message: error.message })
}
