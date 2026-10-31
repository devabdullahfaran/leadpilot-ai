// STUB — signatures are the contract; implementation pending.
import type { AiSettings, LeadPriority } from '@leadpilot/shared'
import type { Db } from '../lib/db'
import type { PipelineContext } from './context'

/** Workspace AI settings from integration_settings(provider='ai').config merged over DEFAULT_AI_SETTINGS. */
export async function getAiSettings(db: Db, workspaceId: string): Promise<AiSettings> {
  void db; void workspaceId
  throw new Error('not implemented')
}

export async function saveAiSettings(ctx: PipelineContext, settings: AiSettings): Promise<AiSettings> {
  void ctx; void settings
  throw new Error('not implemented')
}

export interface SlackSettingsView {
  configured: boolean
  enabled: boolean
  minPriority: LeadPriority
  channelLabel: string | null
  webhookHint: string | null
}

export async function getSlackSettings(db: Db, workspaceId: string): Promise<SlackSettingsView> {
  void db; void workspaceId
  throw new Error('not implemented')
}

/** Decrypted webhook URL, or null when Slack is not configured. Server-side only. */
export async function getSlackWebhookUrl(ctx: PipelineContext): Promise<string | null> {
  void ctx
  throw new Error('not implemented')
}
