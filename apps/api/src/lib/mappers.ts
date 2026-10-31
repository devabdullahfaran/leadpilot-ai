// Database rows (snake_case) → API DTOs (camelCase, see @leadpilot/shared types).
import type {
  ActivityType,
  CriterionResult,
  ExecutionStatus,
  ExecutionStep,
  Lead,
  LeadActivity,
  LeadPriority,
  LeadQualification,
  LeadSource,
  LeadStatus,
  NotificationChannel,
  NotificationEvent,
  NotificationStatus,
  QualificationSource,
  QualificationStatus,
  WorkflowEngine,
  WorkflowExecution,
  WorkflowKey,
  WorkflowTrigger,
} from '@leadpilot/shared'

type PersonRef = { id: string; full_name: string | null } | null

/** PostgREST select strings that match the row types below. */
export const LEAD_SELECT = '*, owner:profiles!leads_owner_id_fkey(id, full_name)'
export const QUALIFICATION_SELECT = '*, creator:profiles!lead_qualifications_created_by_fkey(id, full_name)'
export const ACTIVITY_SELECT = '*, actor:profiles!lead_activities_actor_id_fkey(id, full_name)'
export const EXECUTION_SELECT = '*, lead:leads!workflow_executions_lead_id_fkey(name)'

export interface LeadRow {
  id: string
  workspace_id: string
  name: string
  email: string
  email_normalized: string
  phone: string | null
  phone_normalized: string | null
  company: string
  job_title: string | null
  website: string | null
  source: LeadSource
  message: string
  status: LeadStatus
  score: number | null
  priority: LeadPriority | null
  category: string | null
  ai_summary: string | null
  ai_reasoning: string | null
  recommended_action: string | null
  confidence: number | string | null
  qualification_status: QualificationStatus
  qualification_error: string | null
  last_qualified_at: string | null
  owner_id: string | null
  is_sample: boolean
  submission_count: number
  created_by: string | null
  created_at: string
  updated_at: string
  owner?: PersonRef
}

export interface QualificationRow {
  id: string
  workspace_id: string
  lead_id: string
  source: QualificationSource
  score: number
  priority: LeadPriority
  category: string | null
  summary: string | null
  reasoning: string | null
  recommended_action: string | null
  confidence: number | string | null
  criteria: CriterionResult[]
  adjustments: string[]
  model: string | null
  prompt_version: string | null
  override_reason: string | null
  execution_id: string | null
  created_by: string | null
  is_sample: boolean
  created_at: string
  creator?: PersonRef
}

export interface ActivityRow {
  id: string
  workspace_id: string
  lead_id: string
  type: ActivityType
  body: string | null
  metadata: Record<string, unknown>
  actor_id: string | null
  is_sample: boolean
  created_at: string
  actor?: PersonRef
}

export interface ExecutionRow {
  id: string
  workspace_id: string
  lead_id: string | null
  workflow_key: WorkflowKey
  engine: WorkflowEngine
  trigger: WorkflowTrigger
  status: ExecutionStatus
  steps: ExecutionStep[]
  attempt: number
  retry_of_id: string | null
  error_code: string | null
  error_message: string | null
  idempotency_key: string | null
  result: unknown
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  created_by: string | null
  is_sample: boolean
  lead?: { name: string } | null
}

export interface NotificationRow {
  id: string
  workspace_id: string
  lead_id: string | null
  execution_id: string | null
  channel: NotificationChannel
  status: NotificationStatus
  error: string | null
  payload: Record<string, unknown>
  is_sample: boolean
  created_at: string
}

// numeric columns arrive as strings from PostgREST.
const num = (v: number | string | null): number | null => (v === null ? null : Number(v))
const person = (p: PersonRef | undefined) => (p ? { id: p.id, fullName: p.full_name } : null)

export function mapLead(r: LeadRow): Lead {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    jobTitle: r.job_title,
    website: r.website,
    source: r.source,
    message: r.message,
    status: r.status,
    score: r.score,
    priority: r.priority,
    category: r.category,
    aiSummary: r.ai_summary,
    recommendedAction: r.recommended_action,
    confidence: num(r.confidence),
    qualificationStatus: r.qualification_status,
    qualificationError: r.qualification_error,
    lastQualifiedAt: r.last_qualified_at,
    owner: person(r.owner),
    isSample: r.is_sample,
    submissionCount: r.submission_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function mapQualification(r: QualificationRow): LeadQualification {
  return {
    id: r.id,
    leadId: r.lead_id,
    source: r.source,
    score: r.score,
    priority: r.priority,
    category: r.category,
    summary: r.summary,
    reasoning: r.reasoning,
    recommendedAction: r.recommended_action,
    confidence: num(r.confidence),
    criteria: r.criteria ?? [],
    adjustments: r.adjustments ?? [],
    model: r.model,
    promptVersion: r.prompt_version,
    overrideReason: r.override_reason,
    createdBy: person(r.creator),
    isSample: r.is_sample,
    createdAt: r.created_at,
  }
}

export function mapActivity(r: ActivityRow): LeadActivity {
  return {
    id: r.id,
    leadId: r.lead_id,
    type: r.type,
    body: r.body,
    metadata: r.metadata ?? {},
    actor: person(r.actor),
    isSample: r.is_sample,
    createdAt: r.created_at,
  }
}

export function mapExecution(r: ExecutionRow): WorkflowExecution {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    leadId: r.lead_id,
    leadName: r.lead?.name ?? null,
    workflowKey: r.workflow_key,
    engine: r.engine,
    trigger: r.trigger,
    status: r.status,
    steps: r.steps ?? [],
    attempt: r.attempt,
    retryOfId: r.retry_of_id,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    isSample: r.is_sample,
  }
}

export function mapNotification(r: NotificationRow): NotificationEvent {
  return {
    id: r.id,
    leadId: r.lead_id,
    executionId: r.execution_id,
    channel: r.channel,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
  }
}
