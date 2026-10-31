import type { IntegrationsStatus } from '@leadpilot/shared'

export type AiAvailability =
  | { available: true }
  | { available: false; reason: 'not_configured' | 'globally_disabled' | 'workspace_disabled' | 'quota_exhausted' }

export function aiAvailability(ai: IntegrationsStatus['ai']): AiAvailability {
  if (!ai.configured) return { available: false, reason: 'not_configured' }
  if (!ai.globallyEnabled) return { available: false, reason: 'globally_disabled' }
  if (!ai.workspaceEnabled) return { available: false, reason: 'workspace_disabled' }
  const { usage } = ai
  if (usage.todayWorkspace >= usage.workspaceDailyLimit || (usage.globalDailyLimit > 0 && usage.todayGlobal >= usage.globalDailyLimit)) {
    return { available: false, reason: 'quota_exhausted' }
  }
  return { available: true }
}
