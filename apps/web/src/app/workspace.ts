import { createContext, useContext } from 'react'
import { ROLE_RANK, type WorkspaceRole, type WorkspaceSummary } from '@leadpilot/shared'

export type WorkspaceStatus = 'loading' | 'ready' | 'empty' | 'error'

export interface WorkspaceContextValue {
  status: WorkspaceStatus
  /** The active workspace in user mode; always null in preview mode. */
  workspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  role: WorkspaceRole | null
  error: unknown
  retry: () => void
  /** Persists the choice, then refetches workspace-scoped data. */
  setActiveWorkspace: (id: string) => void
}

const noop = () => {}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  status: 'ready',
  workspace: null,
  workspaces: [],
  role: null,
  error: null,
  retry: noop,
  setActiveWorkspace: noop,
})

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext)
}

/** True when the caller's role is at least `minRole`. Unknown role (preview) → false. */
export function hasRole(role: WorkspaceRole | null, minRole: WorkspaceRole): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minRole]
}
