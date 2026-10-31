// Canonical enumerations shared by the Worker API, the web app, the database
// (CHECK constraints in supabase/migrations) and the n8n workflow.
// Changing a value here requires a matching migration.

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'disqualified'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const LEAD_PRIORITIES = ['high', 'medium', 'low'] as const
export type LeadPriority = (typeof LEAD_PRIORITIES)[number]

/** State of the AI qualification pipeline for a lead (independent of the sales status). */
export const QUALIFICATION_STATUSES = ['pending', 'processing', 'completed', 'needs_review', 'failed', 'skipped'] as const
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number]

export const LEAD_SOURCES = [
  'website_form',
  'landing_page',
  'referral',
  'linkedin',
  'email',
  'phone',
  'event',
  'manual',
  'api',
  'n8n',
  'other',
] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

/** Higher number = more privileges. */
export const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }

export const QUALIFICATION_SOURCES = ['ai', 'manual'] as const
export type QualificationSource = (typeof QUALIFICATION_SOURCES)[number]

export const WORKFLOW_KEYS = ['lead_intake', 'lead_qualification', 'slack_notification'] as const
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number]

/** Where a workflow actually ran. `worker` = Cloudflare Worker pipeline, `n8n` = self-hosted n8n. */
export const WORKFLOW_ENGINES = ['worker', 'n8n'] as const
export type WorkflowEngine = (typeof WORKFLOW_ENGINES)[number]

export const WORKFLOW_TRIGGERS = ['web_form', 'api', 'manual', 'retry', 'n8n_webhook', 'test'] as const
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number]

export const EXECUTION_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export const STEP_STATUSES = ['succeeded', 'failed', 'skipped'] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export const EXECUTION_STEP_KEYS = [
  'validate',
  'deduplicate',
  'ai_classify',
  'persist',
  'notify_slack',
  'email_followup',
] as const
export type ExecutionStepKey = (typeof EXECUTION_STEP_KEYS)[number]

export const ACTIVITY_TYPES = [
  'lead_created',
  'lead_updated',
  'status_changed',
  'owner_changed',
  'note_added',
  'qualification_started',
  'qualification_completed',
  'qualification_failed',
  'qualification_override',
  'duplicate_submission',
  'notification_sent',
  'notification_failed',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const NOTIFICATION_CHANNELS = ['slack', 'email'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const NOTIFICATION_STATUSES = ['sent', 'failed', 'skipped'] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

export const INTEGRATION_PROVIDERS = ['slack', 'ai', 'intake'] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export const AI_USAGE_STATUSES = [
  'success',
  'invalid_response',
  'error',
  'timeout',
  'rejected_quota',
  'rejected_disabled',
] as const
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number]

/** Default lead categories offered to the model. Workspaces can override them in AI settings. */
export const DEFAULT_LEAD_CATEGORIES = [
  'software_development',
  'web_design',
  'mobile_app',
  'ai_automation',
  'data_analytics',
  'consulting',
  'support_request',
  'partnership',
  'job_application',
  'spam',
  'other',
] as const

export const SORTABLE_LEAD_FIELDS = ['created_at', 'updated_at', 'name', 'company', 'score', 'priority', 'status'] as const
export type SortableLeadField = (typeof SORTABLE_LEAD_FIELDS)[number]

export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 25
