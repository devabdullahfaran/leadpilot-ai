import { analyticsQuerySchema, type AnalyticsResponse } from '@leadpilot/shared'
import { Hono } from 'hono'
import { unwrap } from '../lib/errors'
import { readQuery } from '../lib/http'
import type { AppEnv } from '../types'

export const analyticsRoutes = new Hono<AppEnv>()

analyticsRoutes.get('/', async (c) => {
  const scope = c.get('scope')
  const { days } = readQuery(c, analyticsQuerySchema)
  const data = unwrap(
    await scope.db.rpc('lead_analytics', { p_workspace_id: scope.workspaceId, p_days: days }),
    'analytics.leads',
  ) as AnalyticsResponse
  return c.json(data)
})
