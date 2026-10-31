import { executionListQuerySchema, type WorkflowOverviewItem } from '@leadpilot/shared'
import { Hono } from 'hono'
import { conflict, notFound, unwrap } from '../lib/errors'
import { rangeFor, readQuery, requireWrite, uuidParam } from '../lib/http'
import { EXECUTION_SELECT, mapExecution, mapNotification, type ExecutionRow, type NotificationRow } from '../lib/mappers'
import { checkRateLimit } from '../middleware/rate-limit'
import { qualifyLead } from '../services/qualification'
import type { AppEnv } from '../types'
import { actorContext } from './_context'
import { unwrapPage } from './_query'

export const workflowRoutes = new Hono<AppEnv>()

/** Matches the CHECK (attempt between 1 and 20) on workflow_executions. */
const MAX_ATTEMPT = 20

workflowRoutes.get('/overview', async (c) => {
  const scope = c.get('scope')
  const data = unwrap(
    await scope.db.rpc('workflow_overview', { p_workspace_id: scope.workspaceId }),
    'workflows.overview',
  ) as WorkflowOverviewItem[] | null
  return c.json({ data: data ?? [] })
})

workflowRoutes.get('/executions', async (c) => {
  const scope = c.get('scope')
  const q = readQuery(c, executionListQuerySchema)

  const build = (head: boolean) => {
    let query = scope.db
      .from('workflow_executions')
      .select(head ? 'id' : EXECUTION_SELECT, { count: 'exact', head })
      .eq('workspace_id', scope.workspaceId)
    if (q.status) query = query.eq('status', q.status)
    if (q.workflowKey) query = query.eq('workflow_key', q.workflowKey)
    if (q.engine) query = query.eq('engine', q.engine)
    if (q.leadId) query = query.eq('lead_id', q.leadId)
    return query
  }

  const [from, to] = rangeFor(q.page, q.pageSize)
  const { rows, total } = await unwrapPage(
    await build(false)
      .order('started_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
      .overrideTypes<ExecutionRow[], { merge: false }>(),
    () => build(true),
    'workflows.executions',
  )
  return c.json({ data: rows.map(mapExecution), page: q.page, pageSize: q.pageSize, total })
})

workflowRoutes.get('/executions/:id', async (c) => {
  const scope = c.get('scope')
  const id = uuidParam(c, 'id')
  const [execution, notifications] = await Promise.all([
    scope.db
      .from('workflow_executions')
      .select(EXECUTION_SELECT)
      .eq('workspace_id', scope.workspaceId)
      .eq('id', id)
      .maybeSingle<ExecutionRow>(),
    scope.db
      .from('notification_events')
      .select('*')
      .eq('workspace_id', scope.workspaceId)
      .eq('execution_id', id)
      .order('created_at', { ascending: true })
      .overrideTypes<NotificationRow[], { merge: false }>(),
  ])
  const row = unwrap(execution, 'workflows.execution')
  if (!row) throw notFound('Execution')
  const events = unwrap(notifications, 'workflows.execution.notifications') ?? []
  return c.json({ ...mapExecution(row), notifications: events.map(mapNotification) })
})

workflowRoutes.post('/executions/:id/retry', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'member')
  const id = uuidParam(c, 'id')
  await checkRateLimit(c, 'ai', `u:${scope.userId}`)

  const row = unwrap(
    await scope.db
      .from('workflow_executions')
      .select('id, engine, status, lead_id, attempt')
      .eq('workspace_id', scope.workspaceId)
      .eq('id', id)
      .maybeSingle<Pick<ExecutionRow, 'id' | 'engine' | 'status' | 'lead_id' | 'attempt'>>(),
    'workflows.retry.load',
  )
  if (!row) throw notFound('Execution')
  if (row.engine !== 'worker') throw conflict('This execution ran in n8n. Retry it from n8n.')
  if (row.status !== 'failed' && row.status !== 'partial') {
    throw conflict('Only failed or partial executions can be retried')
  }
  if (!row.lead_id) throw conflict('This execution is not linked to a lead, so there is nothing to re-qualify')
  if (row.attempt >= MAX_ATTEMPT) throw conflict(`This execution has reached the maximum of ${MAX_ATTEMPT} attempts`)

  const result = await qualifyLead(actorContext(c, scope), row.lead_id, {
    trigger: 'retry',
    attempt: row.attempt + 1,
    retryOfId: row.id,
  })
  return c.json(result)
})
