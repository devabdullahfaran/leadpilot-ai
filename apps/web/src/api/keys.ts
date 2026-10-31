import type { ApiScope } from './scope'
import type { DuplicateCheckParams, ExecutionListParams, LeadListParams } from './types'

type Scope = Pick<ApiScope, 'mode' | 'workspaceId'>

// Every workspace-scoped key starts with ['lp', mode, workspaceId] so preview and user data,
// and different workspaces, never share cache entries.
const scopeKey = (s: Scope) => ['lp', s.mode, s.workspaceId ?? 'demo'] as const

const leadsAll = (s: Scope) => [...scopeKey(s), 'leads'] as const
const leadDetail = (s: Scope, id: string) => [...leadsAll(s), 'detail', id] as const
const workflowsAll = (s: Scope) => [...scopeKey(s), 'workflows'] as const
const executionsAll = (s: Scope) => [...workflowsAll(s), 'executions'] as const
const integrationsAll = (s: Scope) => [...scopeKey(s), 'integrations'] as const
const settingsAll = (s: Scope) => [...scopeKey(s), 'settings'] as const

export const queryKeys = {
  /** Everything LeadPilot caches. */
  all: ['lp'] as const,
  /** All signed-in data (every workspace). Invalidated on workspace switch. */
  user: ['lp', 'user'] as const,
  health: ['lp', 'health'] as const,
  session: (userId: string | null) => ['lp', 'session', userId ?? 'anonymous'] as const,
  scope: scopeKey,

  dashboard: (s: Scope) => [...scopeKey(s), 'dashboard'] as const,
  analyticsAll: (s: Scope) => [...scopeKey(s), 'analytics'] as const,
  analytics: (s: Scope, days: number) => [...scopeKey(s), 'analytics', days] as const,

  leads: {
    all: leadsAll,
    lists: (s: Scope) => [...leadsAll(s), 'list'] as const,
    list: (s: Scope, params: LeadListParams) => [...leadsAll(s), 'list', params] as const,
    duplicates: (s: Scope, params: DuplicateCheckParams) => [...leadsAll(s), 'duplicates', params] as const,
    detail: leadDetail,
    activities: (s: Scope, id: string) => [...leadDetail(s, id), 'activities'] as const,
    qualifications: (s: Scope, id: string) => [...leadDetail(s, id), 'qualifications'] as const,
  },

  workflows: {
    all: workflowsAll,
    overview: (s: Scope) => [...workflowsAll(s), 'overview'] as const,
    executions: executionsAll,
    executionList: (s: Scope, params: ExecutionListParams) => [...executionsAll(s), 'list', params] as const,
    execution: (s: Scope, id: string) => [...executionsAll(s), 'detail', id] as const,
  },

  integrations: {
    all: integrationsAll,
    status: (s: Scope) => [...integrationsAll(s), 'status'] as const,
    aiUsage: (s: Scope) => [...integrationsAll(s), 'ai-usage'] as const,
  },

  settings: {
    all: settingsAll,
    ai: (s: Scope) => [...settingsAll(s), 'ai'] as const,
    members: (s: Scope) => [...settingsAll(s), 'members'] as const,
  },
}
