// STUB — signatures are the contract; implementation pending.
import type {
  ExecutionStatus,
  ExecutionStepKey,
  WorkflowEngine,
  WorkflowExecution,
  WorkflowKey,
  WorkflowTrigger,
} from '@leadpilot/shared'
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

/**
 * Persists a workflow_executions row ('running') and records timed steps. Every real pipeline run
 * writes exactly one execution row; nothing here is simulated.
 */
export class ExecutionRecorder {
  readonly id: string = ''
  static async start(ctx: PipelineContext, input: StartExecution): Promise<ExecutionRecorder> {
    void ctx; void input
    throw new Error('not implemented')
  }
  setLead(leadId: string): void {
    void leadId
    throw new Error('not implemented')
  }
  /** Runs fn, timing it and recording success/failure (re-throws failures). */
  async step<T>(key: ExecutionStepKey, fn: () => Promise<T>, opts?: { attempts?: (r: T) => number; message?: (r: T) => string | undefined }): Promise<T> {
    void key; void fn; void opts
    throw new Error('not implemented')
  }
  /** Records a step that did not run (e.g. Slack not configured) or that failed without throwing. */
  record(key: ExecutionStepKey, status: 'succeeded' | 'failed' | 'skipped', message?: string, durationMs?: number, attempts?: number): void {
    void key; void status; void message; void durationMs; void attempts
    throw new Error('not implemented')
  }
  async finish(status: Exclude<ExecutionStatus, 'running'>, error?: { code: string; message: string } | null, result?: unknown): Promise<WorkflowExecution> {
    void status; void error; void result
    throw new Error('not implemented')
  }
}
