import type { DashboardSummary } from '@leadpilot/shared'
import { Hono } from 'hono'
import { unwrap } from '../lib/errors'
import { EXECUTION_SELECT, LEAD_SELECT, mapExecution, mapLead, type ExecutionRow, type LeadRow } from '../lib/mappers'
import type { AppEnv } from '../types'

export const dashboardRoutes = new Hono<AppEnv>()

type SummaryAggregates = Omit<DashboardSummary, 'recentLeads' | 'recentErrors' | 'aiActivity'> & {
  aiActivity: Omit<DashboardSummary['aiActivity'], 'dailyLimit'>
}

dashboardRoutes.get('/summary', async (c) => {
  const scope = c.get('scope')
  const [summary, leads, errors] = await Promise.all([
    scope.db.rpc('dashboard_summary', { p_workspace_id: scope.workspaceId }),
    scope.db
      .from('leads')
      .select(LEAD_SELECT)
      .eq('workspace_id', scope.workspaceId)
      .order('created_at', { ascending: false })
      .limit(5)
      .overrideTypes<LeadRow[], { merge: false }>(),
    scope.db
      .from('workflow_executions')
      .select(EXECUTION_SELECT)
      .eq('workspace_id', scope.workspaceId)
      .in('status', ['failed', 'partial'])
      .order('started_at', { ascending: false })
      .limit(5)
      .overrideTypes<ExecutionRow[], { merge: false }>(),
  ])

  const agg = unwrap(summary, 'dashboard.summary') as SummaryAggregates
  const body: DashboardSummary = {
    totals: agg.totals,
    conversion: agg.conversion,
    // round() yields numeric; coerce in case it is ever serialized as a string.
    winRate: agg.winRate === null ? null : Number(agg.winRate),
    aiActivity: { ...agg.aiActivity, dailyLimit: c.get('config').ai.dailyLimitPerWorkspace },
    workflowStatus: agg.workflowStatus,
    recentLeads: (unwrap(leads, 'dashboard.recentLeads') ?? []).map(mapLead),
    recentErrors: (unwrap(errors, 'dashboard.recentErrors') ?? []).map(mapExecution),
    sampleRecordCount: agg.sampleRecordCount,
  }
  return c.json(body)
})
