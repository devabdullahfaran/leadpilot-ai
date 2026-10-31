import { intakeSchema } from '@leadpilot/shared'
import { Hono } from 'hono'
import { ApiError, badRequest, forbidden, unauthorized, unwrap } from '../lib/errors'
import { uuidParam } from '../lib/http'
import { checkRateLimit, clientIp } from '../middleware/rate-limit'
import { processIntake, type IntakeOptions } from '../services/intake'
import { verifyIntakeKey } from '../services/settings'
import type { AppEnv } from '../types'
import { pipelineContext } from './_context'

export const intakeRoutes = new Hono<AppEnv>()

// Identical for an unknown workspace, a workspace without a key and a wrong key, so ids cannot be enumerated.
const BAD_CREDENTIALS = 'Invalid workspace or intake key'

intakeRoutes.post('/:workspaceId', async (c) => {
  const workspaceId = uuidParam(c, 'workspaceId')
  await checkRateLimit(c, 'intake', `ip:${clientIp(c)}:${workspaceId}`)

  const key = c.req.header('X-Intake-Key')?.trim()
  if (!key) throw unauthorized(BAD_CREDENTIALS)

  const serviceDb = c.get('serviceDb')
  // Both lookups always run, so an unknown workspace and a wrong key take the same path.
  const [workspaceRes, keyValid] = await Promise.all([
    serviceDb.from('workspaces').select('id, is_demo').eq('id', workspaceId).maybeSingle<{ id: string; is_demo: boolean }>(),
    verifyIntakeKey(serviceDb, workspaceId, key),
  ])
  const workspace = unwrap(workspaceRes, 'intake.workspace')
  if (workspace?.is_demo) throw forbidden('The portfolio preview workspace does not accept submissions')
  if (!workspace || !keyValid) throw unauthorized(BAD_CREDENTIALS)

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
  // Honeypot: bots fill hidden fields. Checked before validation so bots get the same 202 whatever else
  // they send; nothing is stored.
  const hp = typeof raw === 'object' && raw !== null ? (raw as { hp?: unknown }).hp : undefined
  if (typeof hp === 'string' && hp.trim() !== '') return c.json({ accepted: true as const }, 202)
  const input = intakeSchema.parse(raw)

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || input.submissionId || null
  if (idempotencyKey !== null && (idempotencyKey.length < 8 || idempotencyKey.length > 200)) {
    throw new ApiError(422, 'validation_error', 'Idempotency-Key must be 8 to 200 characters', [
      { path: 'Idempotency-Key', message: 'Must be 8 to 200 characters' },
    ])
  }

  let trigger: IntakeOptions['trigger'] = 'api'
  if (c.req.header('X-LeadPilot-Source')?.trim().toLowerCase() === 'n8n') trigger = 'n8n_webhook'
  else if (input.source === 'website_form' || input.source === 'landing_page') trigger = 'web_form'

  const result = await processIntake(pipelineContext(c, workspaceId, null), input, { trigger, idempotencyKey })
  return c.json(result.body, result.httpStatus)
})
