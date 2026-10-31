import type { WorkspaceRole, WorkspaceSummary } from '@leadpilot/shared'
import type { AppConfig, Bindings } from './env'
import type { Db } from './lib/db'

export interface AuthUser {
  id: string
  email: string | null
}

/**
 * The data scope of a request. Read handlers are written once against a Scope and mounted both for
 * signed-in users (`mode: 'user'`, RLS-enforced client) and for the public portfolio preview
 * (`mode: 'demo'`, service client pinned to the demo workspace, read-only).
 *
 * RULE: every query made with `scope.db` must filter by `scope.workspaceId`. In demo mode the client
 * bypasses RLS, so the filter is the isolation boundary.
 */
export interface Scope {
  mode: 'user' | 'demo'
  workspaceId: string
  role: WorkspaceRole
  userId: string | null
  db: Db
  readOnly: boolean
}

/** Dependencies that tests can replace. */
export interface Deps {
  /** fetch used for third-party calls (Gemini, Slack). PostgREST always uses the global fetch. */
  externalFetch: typeof fetch
  now: () => Date
}

export interface AppEnv {
  Bindings: Bindings
  Variables: {
    requestId: string
    config: AppConfig
    deps: Deps
    /** Service-role client. Bypasses RLS: only use after an explicit authorization check. */
    serviceDb: Db
    user: AuthUser
    workspaces: WorkspaceSummary[]
    scope: Scope
  }
}
