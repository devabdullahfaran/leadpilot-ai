import type { AppConfig } from '../env'
import type { Db } from '../lib/db'
import type { Deps } from '../types'

/** Everything a server-side workflow needs. Built by routes after authorization has been checked. */
export interface PipelineContext {
  config: AppConfig
  /** Service-role client. Every query MUST filter by workspaceId. */
  serviceDb: Db
  deps: Deps
  workspaceId: string
  /** The signed-in user who triggered the work, or null for webhook intake / n8n. */
  actorId: string | null
}
