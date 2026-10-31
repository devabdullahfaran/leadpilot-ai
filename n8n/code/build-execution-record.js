// n8n Code node "Build Execution Record". Every terminal path of the workflow ends here. It inspects which
// nodes ran, derives the ExecutionStep list (packages/shared/src/types.ts) and the overall status, and
// builds the workflow_executions row plus the webhook response. Step timings are measured between the
// Code-node checkpoints (`marks`), so each step's duration includes the HTTP call(s) inside it.
// @include lib/http.js
const finishedAt = Date.now()

function node(name) {
  try {
    return $(name).isExecuted ? $(name).first().json : null
  } catch {
    return null
  }
}

const v = node('Validate & Normalize')
const g = node('Build Gemini Request')
const p = node('Parse & Score')
const r = node('Prepare Lead Records')
const activityRes = node('Log Activity')
const qualificationRes = node('Save Qualification')
const n = node('Prepare Notification')
const s = node('Check Slack Result')
const email = node('Send Follow-up Email')

function step(key, status, start, end, message) {
  const out = { key, status, startedAt: new Date(start).toISOString(), durationMs: Math.max(0, Math.round(end - start)) }
  if (message) out.message = truncate(message, 500)
  return out
}

const steps = []
const startedAt = v.marks.startedAt
steps.push(step('validate', 'succeeded', startedAt, v.marks.validatedAt, v.validateMessage))

// deduplicate
const dedupeEnd = g.marks.dedupedAt
if (g.lookupOk) {
  steps.push(step('deduplicate', 'succeeded', v.marks.validatedAt, dedupeEnd, g.duplicate ? 'Matched existing lead' : 'New lead'))
} else {
  steps.push(step('deduplicate', 'failed', v.marks.validatedAt, dedupeEnd, g.lookupError))
}

// ai_classify
if (!p) {
  steps.push(step('ai_classify', 'skipped', dedupeEnd, dedupeEnd, 'Not run: duplicate lookup failed'))
} else if (p.aiOk) {
  const review = p.ai.qualificationStatus === 'needs_review' ? ', flagged for review' : ''
  const msg = `Score ${p.ai.score} (${p.ai.priority}), category ${p.ai.category}${review}`
  steps.push(step('ai_classify', 'succeeded', g.marks.aiRequestBuiltAt, p.marks.aiCheckedAt, msg))
} else {
  steps.push(step('ai_classify', p.aiSkipped ? 'skipped' : 'failed', g.marks.aiRequestBuiltAt, p.marks.aiCheckedAt, p.aiError.message))
}

// persist: lead write + activity log + qualification history
const persistIssues = []
if (!p) {
  steps.push(step('persist', 'skipped', dedupeEnd, dedupeEnd, 'Not run: duplicate lookup failed'))
} else if (!r.leadSaved) {
  steps.push(step('persist', 'failed', p.marks.scoredAt, r.marks.leadSavedAt, r.leadError))
} else {
  const activityResult = httpResult(activityRes)
  if (!activityResult.ok) persistIssues.push(`activity log failed (${activityResult.error})`)
  if (qualificationRes) {
    const qualificationResult = httpResult(qualificationRes)
    if (!qualificationResult.ok) persistIssues.push(`qualification history insert failed (${qualificationResult.error})`)
  }
  const saved = r.duplicate ? `Updated existing lead (submission #${r.submissionCount})` : 'Created lead'
  const end = n ? n.marks.startedAt : finishedAt
  if (persistIssues.length > 0) {
    steps.push(step('persist', 'failed', p.marks.scoredAt, end, `${saved}; ${persistIssues.join('; ')}`))
  } else {
    const suffix = r.aiOk ? ' and saved qualification' : ` with qualification status "${r.qualificationStatus}"`
    steps.push(step('persist', 'succeeded', p.marks.scoredAt, end, `${saved}${suffix}`))
  }
}

// notify_slack + email_followup
function upstreamReason() {
  if (!p) return 'duplicate lookup failed'
  if (!r.leadSaved) return 'lead was not saved'
  if (!p.aiOk) return 'lead was not qualified'
  return 'notification preparation did not run'
}
const notifyAt = n ? n.marks.preparedAt : finishedAt
if (!n) {
  steps.push(step('notify_slack', 'skipped', finishedAt, finishedAt, `Not run: ${upstreamReason()}`))
} else if (!n.isHighPriority) {
  steps.push(step('notify_slack', 'skipped', notifyAt, notifyAt, `Priority ${p.ai.priority} is below the Slack threshold (high)`))
} else {
  steps.push(step('notify_slack', s.slack.status, notifyAt, s.marks.checkedAt, s.slack.message))
}

let emailFailed = null
if (!n) {
  steps.push(step('email_followup', 'skipped', finishedAt, finishedAt, `Not run: ${upstreamReason()}`))
} else if (!s) {
  steps.push(step('email_followup', 'skipped', notifyAt, notifyAt, 'Only sent for high-priority leads'))
} else if (email && (email.messageId || Array.isArray(email.accepted))) {
  steps.push(step('email_followup', 'succeeded', s.marks.checkedAt, finishedAt, 'Follow-up email sent'))
} else if (email && email.error !== undefined) {
  emailFailed = `Follow-up email failed (${truncate(redact(errorText(email.error)), 300)})`
  steps.push(step('email_followup', 'failed', s.marks.checkedAt, finishedAt, emailFailed))
} else {
  // A disabled n8n node passes its input through unchanged, so no SMTP result means the node is disabled.
  steps.push(step('email_followup', 'skipped', s.marks.checkedAt, s.marks.checkedAt, 'Optional "Send Follow-up Email" node is disabled'))
}

// Overall status, error and HTTP response
let status = 'succeeded'
let httpStatus = 200
let error = null
let responseError = null
const partialErrors = []
if (!g.lookupOk) {
  status = 'failed'
  httpStatus = 500
  error = { code: 'internal_error', message: `${g.lookupError}. Nothing was saved.` }
} else if (!r.leadSaved) {
  status = 'failed'
  httpStatus = 500
  const aiNote = p.aiOk ? '' : ` AI qualification also failed: ${p.aiError.message}`
  error = { code: 'internal_error', message: `${r.leadError}${aiNote}` }
} else if (!p.aiOk && !p.aiSkipped) {
  // Same as the Worker's intake: the lead is captured, so the run is 'partial' with the AI error code. The
  // webhook still reports the failure (502, or 429 for provider quota) so callers can see AI did not run.
  status = 'partial'
  httpStatus = p.aiError.httpStatus
  error = { code: p.aiError.apiCode, message: p.aiError.apiMessage }
  responseError = {
    code: p.aiError.apiCode,
    message: `AI qualification failed: ${p.aiError.apiMessage} The lead was saved with qualification status "failed".`,
  }
  if (p.aiErrorDetails) responseError.quota = p.aiErrorDetails
} else {
  if (persistIssues.length > 0) partialErrors.push({ code: 'internal_error', message: `Lead saved, but ${persistIssues.join('; ')}` })
  if (s && s.slack.status === 'failed') partialErrors.push({ code: 'integration_failed', message: `Slack notification failed: ${s.slack.message}` })
  if (emailFailed) partialErrors.push({ code: 'integration_failed', message: emailFailed })
  if (partialErrors.length > 0) {
    status = 'partial'
    error = { code: partialErrors[0].code, message: partialErrors.map((e) => e.message).join('; ') }
  }
}

const leadId = r && r.leadSaved ? r.leadId : null
const responseBody = {
  leadId,
  duplicate: g.duplicate,
  qualificationStatus: r ? r.qualificationStatus : null,
  engine: 'n8n',
}

const executionRow = {
  workspace_id: v.config.workspaceId,
  lead_id: leadId,
  workflow_key: 'lead_intake',
  engine: 'n8n',
  trigger: 'n8n_webhook',
  status,
  steps,
  attempt: 1,
  error_code: error ? truncate(error.code, 60) : null,
  error_message: error ? truncate(error.message, 2000) : null,
  result: { ...responseBody, httpStatus, n8nExecutionId: $execution.id },
  started_at: new Date(startedAt).toISOString(),
  finished_at: new Date(finishedAt).toISOString(),
  duration_ms: Math.max(0, finishedAt - startedAt),
}

return [
  {
    json: { status, httpStatus, error, responseError: responseError ?? error, responseBody, executionRow, config: v.config },
  },
]
