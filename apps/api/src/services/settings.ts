import {
  aiSettingsSchema,
  DEFAULT_AI_SETTINGS,
  LEAD_PRIORITIES,
  type AiSettings,
  type LeadPriority,
} from '@leadpilot/shared'
import type { Db } from '../lib/db'
import { ApiError, unwrap } from '../lib/errors'
import { log } from '../lib/logger'
import type { PipelineContext } from './context'
import { decryptSecret, encryptSecret, generateIntakeKey, sha256Hex, timingSafeEqualHex } from './crypto'
import { unwrapAs } from './executions'

interface SettingsRow {
  enabled: boolean
  config: Record<string, unknown> | null
}

async function loadSettingsRow(db: Db, workspaceId: string, provider: 'ai' | 'slack' | 'intake'): Promise<SettingsRow | null> {
  return unwrapAs<SettingsRow | null>(
    await db
      .from('integration_settings')
      .select('enabled, config')
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .maybeSingle(),
    `settings.load.${provider}`,
  )
}

async function upsertSettingsRow(ctx: PipelineContext, provider: 'ai' | 'slack' | 'intake', enabled: boolean, config: object): Promise<void> {
  unwrap(
    await ctx.serviceDb
      .from('integration_settings')
      .upsert(
        { workspace_id: ctx.workspaceId, provider, enabled, config, updated_by: ctx.actorId },
        { onConflict: 'workspace_id,provider' },
      ),
    `settings.save.${provider}`,
  )
}

const cloneDefaults = (): AiSettings => structuredClone(DEFAULT_AI_SETTINGS)

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

/** Workspace AI settings from integration_settings(provider='ai').config merged over DEFAULT_AI_SETTINGS. */
export async function getAiSettings(db: Db, workspaceId: string): Promise<AiSettings> {
  const row = await loadSettingsRow(db, workspaceId, 'ai')
  if (!row) return cloneDefaults()
  const config = row.config ?? {}
  const merged = {
    ...cloneDefaults(),
    ...config,
    enabled: typeof config.enabled === 'boolean' ? config.enabled : row.enabled,
  }
  const parsed = aiSettingsSchema.safeParse(merged)
  if (!parsed.success) {
    log('warn', 'ai_settings_invalid', {
      workspaceId,
      issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
    })
    return cloneDefaults()
  }
  return parsed.data
}

export async function saveAiSettings(ctx: PipelineContext, settings: AiSettings): Promise<AiSettings> {
  const parsed = aiSettingsSchema.parse(settings)
  await upsertSettingsRow(ctx, 'ai', parsed.enabled, parsed)
  return parsed
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export interface SlackSettingsView {
  configured: boolean
  enabled: boolean
  minPriority: LeadPriority
  channelLabel: string | null
  webhookHint: string | null
}

interface SlackConfig {
  minPriority: LeadPriority
  channelLabel: string | null
  webhookHint: string | null
}

function readSlackConfig(config: Record<string, unknown> | null | undefined): SlackConfig {
  const c = config ?? {}
  const minPriority = LEAD_PRIORITIES.includes(c.minPriority as LeadPriority) ? (c.minPriority as LeadPriority) : 'high'
  return {
    minPriority,
    channelLabel: typeof c.channelLabel === 'string' && c.channelLabel ? c.channelLabel : null,
    webhookHint: typeof c.webhookHint === 'string' && c.webhookHint ? c.webhookHint : null,
  }
}

/** "hooks.slack.com/…/abcd": enough to recognise a webhook, not enough to use it. */
export function webhookHint(url: string): string {
  return `hooks.slack.com/…/${url.slice(-4)}`
}

/**
 * Members cannot read integration_secrets, so `configured` is derived from the non-secret webhookHint that
 * is written together with the secret (and removed with it).
 */
export async function getSlackSettings(db: Db, workspaceId: string): Promise<SlackSettingsView> {
  const row = await loadSettingsRow(db, workspaceId, 'slack')
  const config = readSlackConfig(row?.config)
  return {
    configured: Boolean(config.webhookHint),
    enabled: Boolean(row?.enabled && config.webhookHint),
    minPriority: config.minPriority,
    channelLabel: config.channelLabel,
    webhookHint: config.webhookHint,
  }
}

export interface SaveSlackSettings {
  webhookUrl?: string
  enabled: boolean
  minPriority: LeadPriority
  channelLabel?: string | null
}

/**
 * Stores Slack settings; a new webhook URL is encrypted with ENCRYPTION_KEY. Throws
 * integration_not_configured (503) without a key, and bad_request when enabling Slack with no webhook stored.
 */
export async function saveSlackSettings(ctx: PipelineContext, input: SaveSlackSettings): Promise<SlackSettingsView> {
  const existing = readSlackConfig((await loadSettingsRow(ctx.serviceDb, ctx.workspaceId, 'slack'))?.config)
  let hint = existing.webhookHint
  if (input.webhookUrl) {
    if (!ctx.config.encryptionKey) {
      throw new ApiError(503, 'integration_not_configured', 'ENCRYPTION_KEY is not set on the server, so the Slack webhook cannot be stored securely')
    }
    const ciphertext = await encryptSecret(input.webhookUrl, ctx.config.encryptionKey)
    unwrap(
      await ctx.serviceDb
        .from('integration_secrets')
        .upsert(
          { workspace_id: ctx.workspaceId, provider: 'slack', ciphertext, secret_hash: null },
          { onConflict: 'workspace_id,provider' },
        ),
      'settings.slack.secret',
    )
    hint = webhookHint(input.webhookUrl)
  } else if (!hint) {
    throw new ApiError(400, 'bad_request', 'webhookUrl is required when configuring Slack for the first time')
  }
  const config: SlackConfig = { minPriority: input.minPriority, channelLabel: input.channelLabel ?? null, webhookHint: hint }
  await upsertSettingsRow(ctx, 'slack', input.enabled, config)
  return { configured: true, enabled: input.enabled, ...config }
}

/** Removes the Slack secret and settings. */
export async function deleteSlackSettings(ctx: PipelineContext): Promise<void> {
  unwrap(
    await ctx.serviceDb.from('integration_secrets').delete().eq('workspace_id', ctx.workspaceId).eq('provider', 'slack'),
    'settings.slack.delete_secret',
  )
  unwrap(
    await ctx.serviceDb.from('integration_settings').delete().eq('workspace_id', ctx.workspaceId).eq('provider', 'slack'),
    'settings.slack.delete_settings',
  )
}

export type SlackDelivery =
  | { ok: true; webhookUrl: string; minPriority: LeadPriority; channelLabel: string | null }
  | { ok: false; reason: string }

/**
 * Everything needed to deliver a Slack alert, or the reason it cannot be delivered. Throws
 * integration_failed when a stored webhook exists but cannot be decrypted (e.g. ENCRYPTION_KEY rotated).
 */
export async function getSlackDelivery(ctx: PipelineContext): Promise<SlackDelivery> {
  const row = await loadSettingsRow(ctx.serviceDb, ctx.workspaceId, 'slack')
  if (!row) return { ok: false, reason: 'Slack is not configured' }
  if (!row.enabled) return { ok: false, reason: 'Slack notifications are disabled' }
  const config = readSlackConfig(row.config)
  const secret = unwrapAs<{ ciphertext: string | null } | null>(
    await ctx.serviceDb
      .from('integration_secrets')
      .select('ciphertext')
      .eq('workspace_id', ctx.workspaceId)
      .eq('provider', 'slack')
      .maybeSingle(),
    'settings.slack.secret',
  )
  if (!secret?.ciphertext) return { ok: false, reason: 'Slack is not configured' }
  if (!ctx.config.encryptionKey) {
    log('warn', 'slack_encryption_key_missing', { workspaceId: ctx.workspaceId })
    return { ok: false, reason: 'ENCRYPTION_KEY is not set on the server' }
  }
  let webhookUrl: string
  try {
    webhookUrl = await decryptSecret(secret.ciphertext, ctx.config.encryptionKey)
  } catch (err) {
    log('error', 'slack_secret_decrypt_failed', { workspaceId: ctx.workspaceId, message: err instanceof Error ? err.message : 'unknown' })
    throw new ApiError(502, 'integration_failed', 'The stored Slack webhook could not be decrypted. Re-save the Slack integration.')
  }
  return { ok: true, webhookUrl, minPriority: config.minPriority, channelLabel: config.channelLabel }
}

/** Decrypted webhook URL, or null when Slack is not configured. Server-side only. */
export async function getSlackWebhookUrl(ctx: PipelineContext): Promise<string | null> {
  const delivery = await getSlackDelivery(ctx)
  return delivery.ok ? delivery.webhookUrl : null
}

// ---------------------------------------------------------------------------
// Intake key (stored as a SHA-256 hash; the display prefix lives in integration_settings.config)
// ---------------------------------------------------------------------------

/** Creates or rotates the workspace intake key. The plaintext key is returned once and never stored. */
export async function rotateIntakeKey(ctx: PipelineContext): Promise<{ key: string; prefix: string }> {
  const { key, prefix } = generateIntakeKey()
  unwrap(
    await ctx.serviceDb
      .from('integration_secrets')
      .upsert(
        { workspace_id: ctx.workspaceId, provider: 'intake', ciphertext: null, secret_hash: await sha256Hex(key) },
        { onConflict: 'workspace_id,provider' },
      ),
    'settings.intake.secret',
  )
  await upsertSettingsRow(ctx, 'intake', true, { keyPrefix: prefix })
  return { key, prefix }
}

/** Constant-time check of a presented intake key against the stored hash. */
export async function verifyIntakeKey(db: Db, workspaceId: string, presented: string): Promise<boolean> {
  if (!presented.startsWith('lpk_') || presented.length > 200) return false
  const row = unwrapAs<{ secret_hash: string | null } | null>(
    await db
      .from('integration_secrets')
      .select('secret_hash')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'intake')
      .maybeSingle(),
    'settings.intake.verify',
  )
  if (!row?.secret_hash) return false
  return timingSafeEqualHex(await sha256Hex(presented), row.secret_hash)
}
