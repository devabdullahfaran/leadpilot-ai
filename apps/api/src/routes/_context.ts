import type { Context } from 'hono'
import type { PipelineContext } from '../services/context'
import type { AppEnv, Scope } from '../types'

/** Pipeline context for server-side work in an explicit workspace (webhook intake: no acting user). */
export function pipelineContext(c: Context<AppEnv>, workspaceId: string, actorId: string | null): PipelineContext {
  return {
    config: c.get('config'),
    serviceDb: c.get('serviceDb'),
    deps: c.get('deps'),
    workspaceId,
    actorId,
  }
}

/** Pipeline context for the request's scope. Call only after requireWrite(), which proves userId is set. */
export function actorContext(c: Context<AppEnv>, scope: Scope & { userId: string }): PipelineContext & { actorId: string } {
  return { ...pipelineContext(c, scope.workspaceId, scope.userId), actorId: scope.userId }
}
