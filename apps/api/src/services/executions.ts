import type {
  ExecutionStatus,
  ExecutionStep,
  ExecutionStepKey,
  WorkflowEngine,
  WorkflowExecution,
  WorkflowKey,
  WorkflowTrigger,
} from '@leadpilot/shared'
import { ApiError, conflict, fromPostgrest, unwrap, type PostgrestErrorLike } from '../lib/errors'
import { log } from '../lib/logger'
import { EXECUTION_SELECT, mapExecution, type ExecutionRow } from '../lib/mappers'
import type { PipelineContext } from './context'

export interface StartExecution {
  workflowKey: WorkflowKey
  trigger: WorkflowTrigger
  engine?: WorkflowEngine
  leadId?: string | null
  attempt?: number
  retryOfId?: string | null
  idempotencyKey?: string | null
}

// Column limits from workflow_executions.
const ERROR_CODE_MAX = 60
const ERROR_MESSAGE_MAX = 2000
const STEP_MESSAGE_MAX = 500

/**
 * unwrap() plus a row type. The client is untyped (no generated Database types) and postgrest-js cannot infer
 * rows for embedded selects, so the select strings in lib/mappers and the row interfaces are kept in sync by hand.
 */
export function unwrapAs<T>(result: { data: unknown; error: PostgrestErrorLike | null }, context: string): T {
  return unwrap(result, context) as T
}

export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Message that is safe to persist/show: ApiError messages are user-facing by design, anything else is not. */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Unexpected internal error'
}

/**
 * Persists a workflow_executions row ('running') and records timed steps. Every real pipeline run
 * writes exactly one execution row; nothing here is simulated.
 */
export class ExecutionRecorder {
  readonly id: string
  private readonly ctx: PipelineContext
  private readonly input: StartExecution
  private readonly startedAt: Date
  private leadId: string | null
  private readonly stepList: ExecutionStep[] = []
  private finishedExecution: WorkflowExecution | null = null

  private constructor(ctx: PipelineContext, id: string, input: StartExecution, startedAt: Date) {
    this.ctx = ctx
    this.id = id
    this.input = input
    this.startedAt = startedAt
    this.leadId = input.leadId ?? null
  }

  static async start(ctx: PipelineContext, input: StartExecution): Promise<ExecutionRecorder> {
    const startedAt = ctx.deps.now()
    const { data, error } = await ctx.serviceDb
      .from('workflow_executions')
      .insert({
        workspace_id: ctx.workspaceId,
        lead_id: input.leadId ?? null,
        workflow_key: input.workflowKey,
        engine: input.engine ?? 'worker',
        trigger: input.trigger,
        status: 'running',
        steps: [],
        attempt: input.attempt ?? 1,
        retry_of_id: input.retryOfId ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        started_at: startedAt.toISOString(),
        created_by: ctx.actorId,
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505' && input.idempotencyKey) {
        throw conflict('A request with this Idempotency-Key is already being processed')
      }
      throw fromPostgrest(error, 'executions.start')
    }
    return new ExecutionRecorder(ctx, (data as { id: string }).id, input, startedAt)
  }

  setLead(leadId: string): void {
    this.leadId = leadId
  }

  get currentLeadId(): string | null {
    return this.leadId
  }

  get steps(): readonly ExecutionStep[] {
    return this.stepList
  }

  get isFinished(): boolean {
    return this.finishedExecution !== null
  }

  hasFailedSteps(): boolean {
    return this.stepList.some((s) => s.status === 'failed')
  }

  private nowMs(): number {
    return this.ctx.deps.now().getTime()
  }

  /** Runs fn, timing it and recording success/failure (re-throws failures). */
  async step<T>(
    key: ExecutionStepKey,
    fn: () => Promise<T>,
    opts?: { attempts?: (r: T) => number; message?: (r: T) => string | undefined },
  ): Promise<T> {
    const started = this.nowMs()
    try {
      const result = await fn()
      this.push(key, 'succeeded', started, this.nowMs() - started, opts?.message?.(result), opts?.attempts?.(result))
      return result
    } catch (err) {
      this.push(key, 'failed', started, this.nowMs() - started, safeErrorMessage(err))
      throw err
    }
  }

  /** Records a step that did not run (e.g. Slack not configured) or that failed without throwing. */
  record(
    key: ExecutionStepKey,
    status: 'succeeded' | 'failed' | 'skipped',
    message?: string,
    durationMs?: number,
    attempts?: number,
  ): void {
    const duration = Math.max(0, Math.round(durationMs ?? 0))
    this.push(key, status, this.nowMs() - duration, duration, message, attempts)
  }

  private push(
    key: ExecutionStepKey,
    status: ExecutionStep['status'],
    startedMs: number,
    durationMs: number,
    message?: string,
    attempts?: number,
  ): void {
    const step: ExecutionStep = {
      key,
      status,
      startedAt: new Date(startedMs).toISOString(),
      durationMs: Math.max(0, Math.round(durationMs)),
    }
    if (attempts !== undefined) step.attempts = attempts
    if (message) step.message = truncateText(message, STEP_MESSAGE_MAX)
    this.stepList.push(step)
  }

  /** In-memory view of the execution while it is still running (used when a caller owns the recorder). */
  snapshot(): WorkflowExecution {
    return (
      this.finishedExecution ?? {
        id: this.id,
        workspaceId: this.ctx.workspaceId,
        leadId: this.leadId,
        leadName: null,
        workflowKey: this.input.workflowKey,
        engine: this.input.engine ?? 'worker',
        trigger: this.input.trigger,
        status: 'running',
        steps: [...this.stepList],
        attempt: this.input.attempt ?? 1,
        retryOfId: this.input.retryOfId ?? null,
        errorCode: null,
        errorMessage: null,
        startedAt: this.startedAt.toISOString(),
        finishedAt: null,
        durationMs: null,
        isSample: false,
      }
    )
  }

  async finish(
    status: Exclude<ExecutionStatus, 'running'>,
    error?: { code: string; message: string } | null,
    result?: unknown,
  ): Promise<WorkflowExecution> {
    if (this.finishedExecution) return this.finishedExecution
    const finishedAt = new Date(Math.max(this.nowMs(), this.startedAt.getTime()))
    const patch: Record<string, unknown> = {
      status,
      steps: this.stepList,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - this.startedAt.getTime(),
      error_code: error ? truncateText(error.code, ERROR_CODE_MAX) : null,
      error_message: error ? truncateText(error.message, ERROR_MESSAGE_MAX) : null,
    }
    if (result !== undefined) patch.result = result
    if (this.leadId) patch.lead_id = this.leadId

    const { data, error: dbError } = await this.ctx.serviceDb
      .from('workflow_executions')
      .update(patch)
      .eq('id', this.id)
      .eq('workspace_id', this.ctx.workspaceId)
      .select(EXECUTION_SELECT)
      .single()
    if (dbError || !data) {
      // The pipeline outcome (including its own error) is logged so it is not lost with the row update.
      log('error', 'execution_finish_failed', {
        executionId: this.id,
        workspaceId: this.ctx.workspaceId,
        status,
        pipelineErrorCode: error?.code,
        pipelineErrorMessage: error?.message,
        dbCode: dbError?.code,
        dbMessage: dbError?.message,
      })
      throw new ApiError(500, 'internal_error', 'Failed to record the workflow execution')
    }
    this.finishedExecution = mapExecution(data as unknown as ExecutionRow)
    return this.finishedExecution
  }
}
