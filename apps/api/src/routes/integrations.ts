import { slackSettingsSchema, type AiUsageEvent, type ExecutionStatus, type IntegrationsStatus } from '@leadpilot/shared'
import { Hono, type Context } from 'hono'
import type { Db } from '../lib/db'
import { ApiError, unwrap } from '../lib/errors'
import { readJson, requireWrite } from '../lib/http'
import { log } from '../lib/logger'
import { mapNotification, type NotificationRow } from '../lib/mappers'
import { ExecutionRecorder } from '../services/executions'
import {
  deleteSlackSettings,
  getAiSettings,
  getSlackDelivery,
  getSlackSettings,
  rotateIntakeKey,
  saveSlackSettings,
} from '../services/settings'
import { postToSlack, type SlackMessage } from '../services/slack'
import type { AppEnv } from '../types'
import { actorContext } from './_context'
import { utcDayStart } from './_query'

export const integrationRoutes = new Hono<AppEnv>()

/** Quota rejections are recorded for visibility but do not consume quota (same rule as reserve_ai_call). */
const NOT_COUNTED = '(rejected_quota,rejected_disabled)'
const AI_ERROR_STATUSES = ['invalid_response', 'error', 'timeout', 'rejected_quota']
const DAY_MS = 24 * 60 * 60 * 1000

const notConfigured = (message: string) => new ApiError(503, 'integration_not_configured', message)

function intakeEndpoint(c: Context<AppEnv>, workspaceId: string): string {
  return `${new URL(c.req.url).origin}/api/v1/intake/${workspaceId}`
}

async function lastSlackDelivery(db: Db, workspaceId: string) {
  const row = unwrap(
    await db
      .from('notification_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'slack')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<NotificationRow>(),
    'integrations.slack.lastDelivery',
  )
  return row ? mapNotification(row) : null
}

/** Slack status from non-secret settings (the URL is never read here). The hint is hidden in the preview. */
async function slackStatus(db: Db, workspaceId: string, demo: boolean): Promise<IntegrationsStatus['slack']> {
  const [view, lastDelivery] = await Promise.all([getSlackSettings(db, workspaceId), lastSlackDelivery(db, workspaceId)])
  return {
    configured: view.configured,
    enabled: view.enabled,
    minPriority: view.minPriority,
    channelLabel: view.channelLabel,
    webhookHint: demo ? null : view.webhookHint,
    lastDelivery,
  }
}

integrationRoutes.get('/', async (c) => {
  const scope = c.get('scope')
  const config = c.get('config')
  const serviceDb = c.get('serviceDb')
  const ws = scope.workspaceId
  const now = c.get('deps').now()
  const dayStart = utcDayStart(now)
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString()

  const [
    aiSettings,
    slack,
    workspaceUsage,
    globalUsage,
    lastSuccess,
    lastError,
    intakeSettings,
    intakeSecret,
    lastIntake,
    lastN8n,
    n8nWeek,
  ] = await Promise.all([
    getAiSettings(scope.db, ws),
    slackStatus(scope.db, ws, scope.mode === 'demo'),
    scope.db
      .from('ai_usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .gte('created_at', dayStart)
      .not('status', 'in', NOT_COUNTED),
    // Global usage spans all workspaces: only a count, and only for signed-in users (never the public preview).
    scope.mode === 'user'
      ? serviceDb
          .from('ai_usage_events')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', dayStart)
          .not('status', 'in', NOT_COUNTED)
      : Promise.resolve({ data: null, count: 0, error: null }),
    scope.db
      .from('ai_usage_events')
      .select('created_at')
      .eq('workspace_id', ws)
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>(),
    scope.db
      .from('ai_usage_events')
      .select('created_at, status, error_code')
      .eq('workspace_id', ws)
      .in('status', AI_ERROR_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string; status: string; error_code: string | null }>(),
    scope.db
      .from('integration_settings')
      .select('enabled, config')
      .eq('workspace_id', ws)
      .eq('provider', 'intake')
      .maybeSingle<{ enabled: boolean; config: { keyPrefix?: unknown } }>(),
    // Existence only: the hash column is never selected.
    serviceDb
      .from('integration_secrets')
      .select('provider')
      .eq('workspace_id', ws)
      .eq('provider', 'intake')
      .maybeSingle<{ provider: string }>(),
    scope.db
      .from('workflow_executions')
      .select('started_at')
      .eq('workspace_id', ws)
      .eq('workflow_key', 'lead_intake')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ started_at: string }>(),
    scope.db
      .from('workflow_executions')
      .select('started_at, status')
      .eq('workspace_id', ws)
      .eq('engine', 'n8n')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ started_at: string; status: ExecutionStatus }>(),
    scope.db
      .from('workflow_executions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .eq('engine', 'n8n')
      .gte('started_at', weekAgo),
  ])

  unwrap(workspaceUsage, 'integrations.usage.workspace')
  unwrap(globalUsage, 'integrations.usage.global')
  unwrap(n8nWeek, 'integrations.n8n.count')
  const success = unwrap(lastSuccess, 'integrations.ai.lastSuccess')
  const failure = unwrap(lastError, 'integrations.ai.lastError')
  const intake = unwrap(intakeSettings, 'integrations.intake.settings')
  const secret = unwrap(intakeSecret, 'integrations.intake.secret')
  const intakeRun = unwrap(lastIntake, 'integrations.intake.last')
  const n8nRun = unwrap(lastN8n, 'integrations.n8n.last')
  const keyPrefix = typeof intake?.config?.keyPrefix === 'string' ? intake.config.keyPrefix : null

  const body: IntegrationsStatus = {
    ai: {
      provider: 'gemini',
      model: config.gemini.model,
      configured: Boolean(config.gemini.apiKey),
      globallyEnabled: config.ai.enabled,
      workspaceEnabled: aiSettings.enabled,
      usage: {
        todayWorkspace: workspaceUsage.count ?? 0,
        workspaceDailyLimit: config.ai.dailyLimitPerWorkspace,
        todayGlobal: globalUsage.count ?? 0,
        globalDailyLimit: config.ai.dailyLimitGlobal,
      },
      lastSuccessAt: success?.created_at ?? null,
      lastErrorAt: failure?.created_at ?? null,
      lastError: failure ? (failure.error_code ? `${failure.status}: ${failure.error_code}` : failure.status) : null,
    },
    slack,
    intake: {
      configured: Boolean(secret) && (intake?.enabled ?? false),
      keyPrefix,
      endpoint: intakeEndpoint(c, ws),
      lastReceivedAt: intakeRun?.started_at ?? null,
    },
    n8n: {
      lastExecutionAt: n8nRun?.started_at ?? null,
      lastStatus: n8nRun?.status ?? null,
      executionsLast7Days: n8nWeek.count ?? 0,
    },
  }
  return c.json(body)
})

integrationRoutes.get('/ai-usage', async (c) => {
  const scope = c.get('scope')
  const rows = unwrap(
    await scope.db
      .from('ai_usage_events')
      .select('id, model, status, latency_ms, prompt_tokens, output_tokens, error_code, created_at')
      .eq('workspace_id', scope.workspaceId)
      // In-flight quota reservations are not part of the AiUsageStatus contract.
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50)
      .overrideTypes<
        {
          id: string
          model: string
          status: AiUsageEvent['status']
          latency_ms: number | null
          prompt_tokens: number | null
          output_tokens: number | null
          error_code: string | null
          created_at: string
        }[],
        { merge: false }
      >(),
    'integrations.aiUsage',
  )
  const data: AiUsageEvent[] = (rows ?? []).map((r) => ({
    id: r.id,
    model: r.model,
    status: r.status,
    latencyMs: r.latency_ms,
    promptTokens: r.prompt_tokens,
    outputTokens: r.output_tokens,
    errorCode: r.error_code,
    createdAt: r.created_at,
  }))
  return c.json({ data })
})

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

integrationRoutes.put('/slack', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  const body = await readJson(c, slackSettingsSchema)
  if (!c.get('config').encryptionKey) {
    throw notConfigured('ENCRYPTION_KEY is not set on the server, so Slack credentials cannot be stored')
  }
  if (!body.webhookUrl && !(await getSlackSettings(scope.db, scope.workspaceId)).configured) {
    throw new ApiError(422, 'validation_error', 'A Slack webhook URL is required to set up Slack', [
      { path: 'webhookUrl', message: 'Required when Slack is not configured yet' },
    ])
  }
  await saveSlackSettings(actorContext(c, scope), {
    webhookUrl: body.webhookUrl,
    enabled: body.enabled,
    minPriority: body.minPriority,
    channelLabel: body.channelLabel ?? null,
  })
  return c.json(await slackStatus(scope.db, scope.workspaceId, false))
})

integrationRoutes.delete('/slack', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  await deleteSlackSettings(actorContext(c, scope))
  return c.body(null, 204)
})

const SLACK_TEST_MESSAGE: SlackMessage = {
  text: 'LeadPilot AI test message: Slack notifications are connected. This is a test, not a lead.',
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*LeadPilot AI test message*\nSlack notifications are connected for this workspace. Leads that meet your priority threshold will be posted here.',
      },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Sent with "Send test" in Integrations. This is not a lead.' }] },
  ],
}

integrationRoutes.post('/slack/test', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  if (!c.get('config').encryptionKey) {
    throw notConfigured('ENCRYPTION_KEY is not set on the server, so the Slack webhook cannot be read')
  }
  const ctx = actorContext(c, scope)
  const delivery = await getSlackDelivery(ctx)
  if (!delivery.ok) throw notConfigured(`Slack test not sent: ${delivery.reason}`)

  const recorder = await ExecutionRecorder.start(ctx, { workflowKey: 'slack_notification', trigger: 'test' })
  const started = Date.now()
  const result = await postToSlack(delivery.webhookUrl, SLACK_TEST_MESSAGE, ctx.deps.externalFetch)
  const durationMs = Date.now() - started
  recorder.record('notify_slack', result.ok ? 'succeeded' : 'failed', result.ok ? 'Test message sent' : result.error, durationMs)

  const { error } = await ctx.serviceDb.from('notification_events').insert({
    workspace_id: scope.workspaceId,
    execution_id: recorder.id,
    channel: 'slack',
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error.slice(0, 1000),
    payload: { kind: 'test' },
  })
  if (error) log('error', 'notification_log_failed', { workspaceId: scope.workspaceId, code: error.code, message: error.message })

  if (!result.ok) {
    await recorder.finish('failed', { code: 'slack_error', message: result.error })
    const status = result.status ? ` (HTTP ${result.status})` : ''
    throw new ApiError(502, 'integration_failed', `Slack did not accept the test message${status}: ${result.error}`)
  }
  await recorder.finish('succeeded')
  return c.json({ status: 'sent' as const })
})

// ---------------------------------------------------------------------------
// Webhook intake key
// ---------------------------------------------------------------------------

integrationRoutes.post('/intake-key', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  // The plaintext key is returned exactly once; only its SHA-256 hash is stored.
  const { key, prefix } = await rotateIntakeKey(actorContext(c, scope))
  return c.json({ key, prefix, endpoint: intakeEndpoint(c, scope.workspaceId) }, 201)
})
