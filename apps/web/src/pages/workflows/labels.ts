import type { ExecutionStepKey, WorkflowKey } from '@leadpilot/shared'

export const WORKFLOW_LABEL: Record<WorkflowKey, string> = {
  lead_intake: 'Lead intake',
  lead_qualification: 'AI qualification',
  slack_notification: 'Slack notification',
}

export const STEP_LABEL: Record<ExecutionStepKey, string> = {
  validate: 'Validate',
  deduplicate: 'Deduplicate',
  ai_classify: 'AI classify',
  persist: 'Persist',
  notify_slack: 'Slack alert',
  email_followup: 'Email follow-up',
}
