import type { WorkspaceRole } from '@leadpilot/shared'
import { useDataMode } from '@/app/data-mode'
import { hasRole, useWorkspace } from '@/app/workspace'
import { formatEnumLabel } from '@/lib/format'

export interface MutationGuardOptions {
  /** Completes "Sign in to …", e.g. "create leads". */
  action?: string
  /** Minimum workspace role in user mode (see docs/API.md roles). */
  minRole?: WorkspaceRole
}

export interface MutationGuard {
  allowed: boolean
  /** Why the control is disabled, for its tooltip. Null when allowed. */
  reason: string | null
}

/** Whether the current viewer may perform a mutation: never in preview, and only with enough role in user mode. */
export function useMutationGuard({ action, minRole }: MutationGuardOptions = {}): MutationGuard {
  const { readOnly } = useDataMode()
  const { role } = useWorkspace()
  if (readOnly) return { allowed: false, reason: `Sign in to ${action ?? 'make changes'}` }
  if (minRole && !hasRole(role, minRole)) {
    return { allowed: false, reason: `Requires the ${formatEnumLabel(minRole)} role or higher` }
  }
  return { allowed: true, reason: null }
}
