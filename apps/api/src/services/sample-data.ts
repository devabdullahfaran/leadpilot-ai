// STUB — signatures are the contract; implementation pending.
import type { PipelineContext } from './context'

/** Inserts the synthetic sample dataset (is_sample = true) into the workspace. Idempotent. */
export async function loadSampleData(ctx: PipelineContext): Promise<{ leads: number }> {
  void ctx
  throw new Error('not implemented')
}

/** Deletes every is_sample row in the workspace (leads cascade to their history). */
export async function clearSampleData(ctx: PipelineContext): Promise<{ leads: number }> {
  void ctx
  throw new Error('not implemented')
}
