// Response shapes from docs/API.md that are not exported by @leadpilot/shared.
import type { NotificationEvent, WorkflowExecution, leadListQuerySchema, executionListQuerySchema, leadUpdateSchema } from '@leadpilot/shared'
import type { z } from 'zod'

// z.coerce inputs are `unknown` in zod 4; the client always sends numbers.
type Paging<T> = Omit<T, 'page' | 'pageSize'> & { page?: number; pageSize?: number }

/** Query params accepted by `GET /leads` (all optional; server applies defaults). */
export type LeadListParams = Paging<z.input<typeof leadListQuerySchema>>
/** Query params accepted by `GET /workflows/executions`. */
export type ExecutionListParams = Paging<z.input<typeof executionListQuerySchema>>
/** Body accepted by `PATCH /leads/:id`. */
export type LeadUpdateInput = z.input<typeof leadUpdateSchema>

export interface DuplicateCheckParams {
  email?: string
  phone?: string
  company?: string
  excludeId?: string
}

export interface DuplicateMatch {
  id: string
  name: string
  email: string
  company: string
  matchedOn: ('email' | 'phone' | 'company')[]
}

export type ExecutionDetail = WorkflowExecution & { notifications: NotificationEvent[] }

export interface IntakeKeyResult {
  /** Shown once. Stored server-side as a SHA-256 hash only. */
  key: string
  prefix: string
  endpoint: string
}

export interface SampleDataResult {
  leads: number
}

export interface HealthStatus {
  status: string
  version: string
  environment: string
  time: string
}
