// n8n Code node "Validate & Normalize" (Run Once for All Items). Body of an n8n Code node: top-level
// `return`, n8n globals ($input, $env). Mirrors the Worker's intake route (apps/api/src/routes/intake.ts):
// honeypot first, then intakeSchema limits (packages/shared/src/schemas.ts), then the website/phone rules
// of packages/shared/src/normalize.ts. Built into the workflow JSON by n8n/build-workflow.mjs.
const startedAt = Date.now()

const LEAD_SOURCES = ['website_form', 'landing_page', 'referral', 'linkedin', 'email', 'phone', 'event', 'manual', 'api', 'n8n', 'other']
// Same pattern as z.email() in Zod 4 (applied after trim + lowercase).
const EMAIL_RE = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL_RE = /^[a-z0-9][a-z0-9.-]{2,63}$/
const SLACK_URL_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/

function reject(httpStatus, body, extra) {
  return [{ json: { valid: false, httpStatus, responseBody: body, ...extra } }]
}

// ---- Configuration ($env needs N8N_BLOCK_ENV_ACCESS_IN_NODE=false) -------------------------------------
function readEnv(name) {
  try {
    const value = $env[name]
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    throw new Error('Environment access is blocked. Set N8N_BLOCK_ENV_ACCESS_IN_NODE=false for n8n.')
  }
}

const configProblems = []
let config = null
try {
  const workspaceId = readEnv('LEADPILOT_WORKSPACE_ID')
  const supabaseUrl = readEnv('SUPABASE_URL').replace(/\/+$/, '')
  const geminiModel = readEnv('GEMINI_MODEL') || 'gemini-3.5-flash-lite'
  const slackWebhookUrl = readEnv('SLACK_WEBHOOK_URL')
  const followUpFrom = readEnv('FOLLOWUP_FROM_EMAIL')
  // Same kill switch and daily limits as the Worker (apps/api/src/env.ts): AI runs unless AI_ENABLED=false,
  // and every Gemini call is first reserved against the shared reserve_ai_call quota.
  const aiEnabled = readEnv('AI_ENABLED').toLowerCase() !== 'false'
  const limit = (name, fallback, max) => {
    const raw = readEnv(name)
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0 || value > max) configProblems.push(`${name} must be an integer from 0 to ${max}`)
    return value
  }
  const aiDailyLimitPerWorkspace = limit('AI_DAILY_LIMIT_PER_WORKSPACE', 25, 10000)
  const aiDailyLimitGlobal = limit('AI_DAILY_LIMIT_GLOBAL', 150, 100000)
  if (!UUID_RE.test(workspaceId)) configProblems.push('LEADPILOT_WORKSPACE_ID must be a workspace UUID')
  if (!/^https?:\/\/[^\s/]+$/.test(supabaseUrl)) configProblems.push('SUPABASE_URL must be like https://<project-ref>.supabase.co')
  if (!MODEL_RE.test(geminiModel)) configProblems.push('GEMINI_MODEL must be a model id such as gemini-3.5-flash-lite')
  let slackSkipReason = null
  if (!slackWebhookUrl) slackSkipReason = 'SLACK_WEBHOOK_URL is not set'
  else if (!SLACK_URL_RE.test(slackWebhookUrl)) slackSkipReason = 'SLACK_WEBHOOK_URL is not a Slack incoming webhook URL'
  config = {
    workspaceId: workspaceId.toLowerCase(),
    supabaseUrl,
    geminiModel,
    aiEnabled,
    aiDailyLimitPerWorkspace,
    aiDailyLimitGlobal,
    slackConfigured: slackSkipReason === null,
    slackSkipReason,
    followUpFromConfigured: EMAIL_RE.test(followUpFrom.toLowerCase()),
  }
} catch (error) {
  configProblems.push(error.message)
}

if (configProblems.length > 0) {
  // Details stay in the n8n execution log; the public caller only learns that the workflow is misconfigured.
  return reject(
    500,
    { error: { code: 'internal_error', message: 'The LeadPilot n8n workflow is misconfigured. Check the n8n execution log.' } },
    { outcome: 'config_error', configProblems },
  )
}

// ---- Normalization (packages/shared/src/normalize.ts) -------------------------------------------------
function normalizePhone(phone) {
  if (!phone) return null
  const trimmed = phone.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7) return null
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

// Fallback for runtimes whose Code sandbox does not expose the WHATWG URL class.
function fallbackWebsite(withScheme) {
  const m = /^(https?):\/\/([^/?#\s@]+)([^#\s]*)(?:#.*)?$/i.exec(withScheme)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const defaultPort = scheme === 'https' ? ':443' : ':80'
  let host = m[2].toLowerCase()
  if (host.endsWith(defaultPort)) host = host.slice(0, -defaultPort.length)
  if (!host.split(':')[0].includes('.')) return null
  const rest = m[3].startsWith('/') ? m[3] : `/${m[3]}`
  return `${scheme}://${host}${rest}`.replace(/\/$/, '')
}

function normalizeWebsite(website) {
  if (!website) return null
  const trimmed = website.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (typeof URL !== 'function') return fallbackWebsite(withScheme)
  try {
    const url = new URL(withScheme)
    if (!url.hostname.includes('.')) return null
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

// ---- Validation (intakeSchema) ------------------------------------------------------------------------
const request = $input.first().json
const body = request.body
if (!body || typeof body !== 'object' || Array.isArray(body)) {
  return reject(400, { error: { code: 'bad_request', message: 'Request body must be a JSON object' } }, { outcome: 'invalid' })
}

// Honeypot: checked before validation so bots get the same 202 whatever else they send; nothing is stored.
if (typeof body.hp === 'string' && body.hp.trim() !== '') return reject(202, { accepted: true }, { outcome: 'honeypot' })

const errors = []
const add = (path, message) => errors.push({ path, message })

function requiredText(path, max, min = 1) {
  const value = body[path]
  if (typeof value !== 'string') {
    add(path, value === undefined || value === null ? 'Required' : 'Expected a string')
    return null
  }
  const text = value.trim()
  if (text.length < min) add(path, min === 1 ? 'Required' : `Must be at least ${min} characters`)
  else if (text.length > max) add(path, `Must be at most ${max} characters`)
  return text
}

function optionalText(path, max) {
  const value = body[path]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    add(path, 'Expected a string')
    return null
  }
  const text = value.trim()
  if (text.length > max) add(path, `Must be at most ${max} characters`)
  return text || null
}

const name = requiredText('name', 120)
let email = null
if (typeof body.email !== 'string') {
  add('email', body.email === undefined || body.email === null ? 'Required' : 'Expected a string')
} else {
  email = body.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) add('email', 'Invalid email address')
  if (email.length > 254) add('email', 'Must be at most 254 characters')
}
const phone = optionalText('phone', 40)
const company = requiredText('company', 160)
const jobTitle = optionalText('jobTitle', 120)
const website = optionalText('website', 300)
let source = 'website_form'
if (body.source !== undefined) {
  if (typeof body.source === 'string' && LEAD_SOURCES.includes(body.source)) source = body.source
  else add('source', `Must be one of: ${LEAD_SOURCES.join(', ')}`)
}
const message = requiredText('message', 5000, 10)
if (body.hp !== undefined) {
  if (typeof body.hp !== 'string') add('hp', 'Expected a string')
  else if (body.hp.length > 200) add('hp', 'Must be at most 200 characters')
}
let submissionId = null
if (body.submissionId !== undefined) {
  if (typeof body.submissionId !== 'string') add('submissionId', 'Expected a string')
  else {
    submissionId = body.submissionId.trim()
    if (submissionId.length < 8) add('submissionId', 'Must be at least 8 characters')
    else if (submissionId.length > 100) add('submissionId', 'Must be at most 100 characters')
  }
}

if (errors.length > 0) {
  return reject(
    422,
    { error: { code: 'validation_error', message: 'Invalid lead submission', details: errors } },
    { outcome: 'invalid' },
  )
}

// Like the Worker: a parseable website is normalized, anything else is kept as entered (the DB column
// allows 300 characters, so an over-long normalized form also falls back to the input).
const normalizedWebsite = normalizeWebsite(website)
const websiteParsed = normalizedWebsite !== null && normalizedWebsite.length <= 300
const lead = {
  name,
  email,
  phone,
  // The database derives phone_normalized itself; this copy is for the execution log only.
  phoneNormalized: normalizePhone(phone),
  company,
  jobTitle,
  website: websiteParsed ? normalizedWebsite : website,
  submittedSource: source,
  message,
  submissionId,
}

return [
  {
    json: {
      valid: true,
      outcome: 'valid',
      httpStatus: 200,
      validateMessage:
        website && !websiteParsed ? 'Submission is valid; website kept as entered (not a parseable URL)' : 'Submission is valid',
      config,
      lead,
      marks: { startedAt, validatedAt: Date.now() },
    },
  },
]
