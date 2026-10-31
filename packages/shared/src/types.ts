// JSON shapes returned by the Worker API (camelCase). The database uses snake_case;
// the API layer maps between them.
import type {
  ActivityType,
  AiUsageStatus,
  ExecutionStatus,
  ExecutionStepKey,
  LeadPriority,
  LeadSource,
  LeadStatus,
  NotificationChannel,
  NotificationStatus,
  QualificationSource,
  QualificationStatus,
  StepStatus,
  WorkflowEngine,
  WorkflowKey,
  WorkflowTrigger,
  WorkspaceRole,
} from './constants'
import type { AiSettings } from './schemas'

export interface Paginated<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export interface MemberSummary {
  userId: string
  fullName: string | null
  email: string | null
  role: WorkspaceRole
}

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  role: WorkspaceRole
  isDemo: boolean
}

export interface SessionInfo {
  user: { id: string; email: string | null; fullName: string | null }
  workspaces: WorkspaceSummary[]
  /** The workspace the request was scoped to (X-Workspace-Id header, or the first membership). */
  activeWorkspaceId: string | null
}

export interface Lead {
  id: string
  workspaceId: string
  name: string
  email: string
  phone: string | null
  company: string
  jobTitle: string | null
  website: string | null
  source: LeadSource
  message: string
  status: LeadStatus
  score: number | null
  priority: LeadPriority | null
  category: string | null
  aiSummary: string | null
  recommendedAction: string | null
  confidence: number | null
  qualificationStatus: QualificationStatus
  qualificationError: string | null
  lastQualifiedAt: string | null
  owner: { id: string; fullName: string | null } | null
  isSample: boolean
  submissionCount: number
  createdAt: string
  updatedAt: string
}

export interface CriterionResult {
  key: string
  score: number
  note?: string
}

export interface LeadQualification {
  id: string
  leadId: string
  source: QualificationSource
  score: number
  priority: LeadPriority
  category: string | null
  summary: string | null
  reasoning: string | null
  recommendedAction: string | null
  confidence: number | null
  criteria: CriterionResult[]
  adjustments: string[]
  model: string | null
  promptVersion: string | null
  overrideReason: string | null
  createdBy: { id: string; fullName: string | null } | null
  isSample: boolean
  createdAt: string
}

export interface LeadActivity {
  id: string
  leadId: string
  type: ActivityType
  body: string | null
  metadata: Record<string, unknown>
  actor: { id: string; fullName: string | null } | null
  isSample: boolean
  createdAt: string
}

export interface ExecutionStep {
  key: ExecutionStepKey
  status: StepStatus
  startedAt: string
  durationMs: number
  attempts?: number
  message?: string
}

export interface WorkflowExecution {
  id: string
  workspaceId: string
  leadId: string | null
  leadName: string | null
  workflowKey: WorkflowKey
  engine: WorkflowEngine
  trigger: WorkflowTrigger
  status: ExecutionStatus
  steps: ExecutionStep[]
  attempt: number
  retryOfId: string | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  isSample: boolean
}

export interface WorkflowOverviewItem {
  workflowKey: WorkflowKey
  engine: WorkflowEngine
  total: number
  succeeded: number
  partial: number
  failed: number
  running: number
  avgDurationMs: number | null
  lastRunAt: string | null
  lastStatus: ExecutionStatus | null
}

export interface DashboardSummary {
  totals: {
    leads: number
    qualified: number
    highPriority: number
    needsReview: number
  }
  conversion: { status: LeadStatus; count: number }[]
  winRate: number | null
  aiActivity: {
    last7Days: number
    succeeded: number
    failed: number
    todayUsed: number
    dailyLimit: number
  }
  workflowStatus: { succeeded: number; partial: number; failed: number; running: number }
  recentLeads: Lead[]
  recentErrors: WorkflowExecution[]
  sampleRecordCount: number
}

export interface AnalyticsResponse {
  days: number
  leadVolume: { date: string; count: number }[]
  sources: { source: LeadSource; count: number }[]
  scoreDistribution: { bucket: string; count: number }[]
  qualificationResults: { status: QualificationStatus; count: number }[]
  priorities: { priority: LeadPriority | 'unscored'; count: number }[]
  workflowOutcomes: { date: string; succeeded: number; partial: number; failed: number }[]
  sampleRecordCount: number
}

export interface NotificationEvent {
  id: string
  leadId: string | null
  executionId: string | null
  channel: NotificationChannel
  status: NotificationStatus
  error: string | null
  createdAt: string
}

export interface IntegrationsStatus {
  ai: {
    provider: 'gemini'
    model: string
    /** GEMINI_API_KEY is present on the server. The key itself is never returned. */
    configured: boolean
    /** Global kill switch (AI_ENABLED server variable). */
    globallyEnabled: boolean
    /** Workspace setting. */
    workspaceEnabled: boolean
    usage: {
      todayWorkspace: number
      workspaceDailyLimit: number
      todayGlobal: number
      globalDailyLimit: number
    }
    lastSuccessAt: string | null
    lastErrorAt: string | null
    lastError: string | null
  }
  slack: {
    configured: boolean
    enabled: boolean
    minPriority: LeadPriority
    channelLabel: string | null
    /** e.g. "hooks.slack.com/…/abcd" — enough to recognise, not enough to use. */
    webhookHint: string | null
    lastDelivery: NotificationEvent | null
  }
  intake: {
    configured: boolean
    keyPrefix: string | null
    endpoint: string
    lastReceivedAt: string | null
  }
  n8n: {
    /** n8n is self-hosted; this only reports executions n8n has written back. */
    lastExecutionAt: string | null
    lastStatus: ExecutionStatus | null
    executionsLast7Days: number
  }
}

export interface AiUsageEvent {
  id: string
  model: string
  status: AiUsageStatus
  latencyMs: number | null
  promptTokens: number | null
  outputTokens: number | null
  errorCode: string | null
  createdAt: string
}

export type { AiSettings }

export interface QualifyResult {
  lead: Lead
  qualification: LeadQualification | null
  execution: WorkflowExecution
}

export interface IntakeResult {
  leadId: string
  executionId: string
  duplicate: boolean
  qualificationStatus: QualificationStatus
  /** True when this response was replayed for a repeated Idempotency-Key. */
  replayed: boolean
}
