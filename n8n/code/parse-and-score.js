// n8n Code node "Parse & Score". Classifies the Gemini HTTP result like apps/api/src/services/gemini.ts,
// validates the model JSON with the same rules as parseAiQualification (packages/shared/src/ai.ts),
// reconciles the score exactly like reconcileScore/qualificationOutcome (packages/shared/src/scoring.ts)
// and prepares the lead write.
// @include lib/http.js
// @include lib/ai-settings.js
const aiCheckedAt = Date.now()

// ---- Model output validation (aiQualificationOutputSchema + category check) ---------------------------
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkString(issues, path, value, min, max) {
  if (typeof value !== 'string') return issues.push(`${path}: expected string`)
  if (value.length < min) issues.push(`${path}: too short (min ${min})`)
  if (value.length > max) issues.push(`${path}: too long (max ${max})`)
}

function checkNumber(issues, path, value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return issues.push(`${path}: expected number`)
  if (value < min) issues.push(`${path}: must be >= ${min}`)
  if (value > max) issues.push(`${path}: must be <= ${max}`)
}

function stripJsonFence(text) {
  const t = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t)
  return fence ? fence[1] : t
}

function parseAiQualification(raw, settings) {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(stripJsonFence(raw))
    } catch {
      return { ok: false, issues: ['Response was not valid JSON'] }
    }
  }
  if (!isObject(data)) return { ok: false, issues: ['(root): expected object'] }
  const issues = []
  checkNumber(issues, 'score', data.score, 0, 100)
  if (!LEAD_PRIORITIES.includes(data.priority)) issues.push(`priority: expected one of ${LEAD_PRIORITIES.join('|')}`)
  checkString(issues, 'category', data.category, 1, 60)
  checkString(issues, 'summary', data.summary, 1, 400)
  checkString(issues, 'reasoning', data.reasoning, 1, 1200)
  checkString(issues, 'recommendedAction', data.recommendedAction, 1, 300)
  checkNumber(issues, 'confidence', data.confidence, 0, 1)
  const criteria = []
  if (!Array.isArray(data.criteria)) {
    issues.push('criteria: expected array')
  } else {
    if (data.criteria.length > 10) issues.push('criteria: too many items (max 10)')
    data.criteria.forEach((c, i) => {
      if (!isObject(c)) return issues.push(`criteria.${i}: expected object`)
      checkString(issues, `criteria.${i}.key`, c.key, 1, 40)
      checkNumber(issues, `criteria.${i}.score`, c.score, 0, 100)
      if (c.note !== undefined) checkString(issues, `criteria.${i}.note`, c.note, 0, 300)
      criteria.push(c.note === undefined ? { key: c.key, score: c.score } : { key: c.key, score: c.score, note: c.note })
    })
  }
  if (issues.length > 0) return { ok: false, issues }
  if (!settings.categories.includes(data.category)) {
    return { ok: false, issues: [`category: "${data.category}" is not one of the configured categories`] }
  }
  const value = {
    score: data.score,
    priority: data.priority,
    category: data.category,
    summary: data.summary,
    reasoning: data.reasoning,
    recommendedAction: data.recommendedAction,
    confidence: data.confidence,
    criteria,
  }
  return { ok: true, value }
}

// ---- Scoring (packages/shared/src/scoring.ts) ---------------------------------------------------------
function clampScore(score) {
  return Math.min(100, Math.max(0, Math.round(score)))
}

function priorityFromScore(score, thresholds) {
  const s = clampScore(score)
  if (s >= thresholds.high) return 'high'
  if (s >= thresholds.medium) return 'medium'
  return 'low'
}

function reconcileScore(statedScore, criteria, rubric, thresholds, statedPriority, category) {
  const adjustments = []
  let score = clampScore(statedScore)
  if (criteria.length > 0) {
    const maxByKey = new Map(rubric.map((c) => [c.key, c.maxPoints]))
    const seen = new Set()
    let sum = 0
    for (const c of criteria) {
      const max = maxByKey.get(c.key)
      if (max === undefined) {
        adjustments.push(`Ignored unknown criterion "${c.key}".`)
        continue
      }
      // The response schema cannot enforce unique keys, so a repeated criterion would be counted twice.
      if (seen.has(c.key)) {
        adjustments.push(`Ignored duplicate criterion "${c.key}".`)
        continue
      }
      seen.add(c.key)
      const clamped = Math.min(max, Math.max(0, Math.round(c.score)))
      if (clamped !== c.score) adjustments.push(`Clamped "${c.key}" from ${c.score} to ${clamped}.`)
      sum += clamped
    }
    if (Math.abs(sum - score) > SCORE_SUM_TOLERANCE) {
      adjustments.push(`Stated score ${score} differed from criterion total ${sum}; using criterion total.`)
      score = clampScore(sum)
    }
  }
  let priority = priorityFromScore(score, thresholds)
  if (category === 'spam' && priority !== 'low') {
    adjustments.push('Category "spam" forces low priority.')
    priority = 'low'
  }
  if (statedPriority && statedPriority !== priority) {
    adjustments.push(`Model suggested "${statedPriority}" priority; score ${score} maps to "${priority}".`)
  }
  return { score, priority, adjustments }
}

function qualificationOutcome(confidence, category, reviewConfidence) {
  if (confidence < reviewConfidence || category === 'spam') return 'needs_review'
  return 'completed'
}

// ---- Gemini HTTP result classification (mirrors apps/api/src/services/gemini.ts) ------------------------
const BLOCKED_FINISH_REASONS = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']

function readUsage(body) {
  const u = isObject(body.usageMetadata) ? body.usageMetadata : null
  if (!u) return { promptTokens: null, outputTokens: null }
  const hasOutput = u.candidatesTokenCount !== undefined || u.thoughtsTokenCount !== undefined
  return {
    promptTokens: typeof u.promptTokenCount === 'number' ? u.promptTokenCount : null,
    outputTokens: hasOutput ? (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) : null,
  }
}

// Free-tier daily quota exhaustion will not clear within a retry window.
function isDailyQuota(err) {
  const details = Array.isArray(err?.details) ? err.details : []
  return details.some(
    (d) => String(d['@type'] ?? '').endsWith('google.rpc.QuotaFailure') && (d.violations ?? []).some((v) => /PerDay/i.test(v.quotaId ?? '')),
  )
}

function interpretError(status, body) {
  const err = isObject(body) && isObject(body.error) ? body.error : null
  const statusName = err?.status ? ` ${err.status}` : ''
  const apiKeyInvalid = Array.isArray(err?.details) && err.details.some((d) => d.reason === 'API_KEY_INVALID')
  if (status === 401 || status === 403 || apiKeyInvalid) {
    return { code: 'auth_error', message: `Gemini rejected the API key (HTTP ${status}${statusName}). Check the Gemini credential in n8n.` }
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      message: isDailyQuota(err)
        ? 'Gemini free-tier daily quota is exhausted for this API key. Try again tomorrow or use a paid key.'
        : 'Gemini rate limit or free-tier quota reached (HTTP 429). Try again in a minute.',
    }
  }
  if (status >= 500) {
    return { code: 'unavailable', message: `Gemini is temporarily unavailable (HTTP ${status}${statusName}). Try again later.` }
  }
  const detail = typeof err?.message === 'string' && err.message ? `: ${truncate(err.message, 200)}` : ''
  return { code: 'bad_request', message: `Gemini rejected the request (HTTP ${status}${statusName})${detail}` }
}

function readGemini(item) {
  const res = httpResult(item)
  if (res.status === null) {
    // The node threw (after n8n's Retry On Fail attempts) and continued with { error }.
    if (/timed?\s*out|ETIMEDOUT|ECONNABORTED/i.test(res.error)) {
      return { ok: false, code: 'timeout', message: 'Gemini did not respond within 20s (n8n Retry On Fail: up to 3 attempts).' }
    }
    return { ok: false, code: 'unavailable', message: 'Could not reach the Gemini API (network error).' }
  }
  if (!res.ok) return { ok: false, ...interpretError(res.status, res.body) }
  if (!isObject(res.body)) return { ok: false, code: 'invalid_response', message: 'Gemini returned a response body that was not JSON.' }
  const body = res.body
  const usage = readUsage(body)
  if (isObject(body.promptFeedback) && body.promptFeedback.blockReason) {
    return { ok: false, code: 'blocked', message: `Gemini blocked the request (${body.promptFeedback.blockReason}).`, usage }
  }
  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined
  if (!isObject(candidate)) return { ok: false, code: 'invalid_response', message: 'Gemini returned no candidates.', usage }
  const finishReason = candidate.finishReason ?? ''
  if (BLOCKED_FINISH_REASONS.includes(finishReason)) {
    return { ok: false, code: 'blocked', message: `Gemini blocked the response (${finishReason}).`, usage }
  }
  const parts = isObject(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : []
  const text = parts
    .filter((p) => isObject(p) && p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
  if (!text.trim()) {
    const why = finishReason ? ` (finishReason ${finishReason})` : ''
    return { ok: false, code: 'invalid_response', message: `Gemini returned an empty response${why}.`, usage }
  }
  return { ok: true, text, usage, finishReason }
}

// Same mapping as apiErrorForGemini in apps/api/src/services/qualification.ts.
function apiError(code, message) {
  if (code === 'ai_disabled') return { apiCode: 'ai_disabled', httpStatus: 503, apiMessage: message }
  if (code === 'quota_exceeded') return { apiCode: 'ai_quota_exceeded', httpStatus: 429, apiMessage: message }
  if (code === 'rate_limited') {
    return { apiCode: 'ai_quota_exceeded', httpStatus: 429, apiMessage: `The AI provider's quota or rate limit was reached. ${message}` }
  }
  if (code === 'invalid_response' || code === 'blocked') return { apiCode: 'ai_invalid_response', httpStatus: 502, apiMessage: message }
  return { apiCode: 'ai_unavailable', httpStatus: 502, apiMessage: message }
}

// ---- Main -----------------------------------------------------------------------------------------------
const ctx = $('Validate & Normalize').first().json
const req = $('Build Gemini Request').first().json
function executed(name) {
  try {
    return $(name).isExecuted
  } catch {
    return false
  }
}

// Seconds until the daily quota window (UTC midnight) resets, like the Worker's ai_quota_exceeded details.
function secondsUntilUtcMidnight(now) {
  const d = new Date(now)
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000))
}

// Gate before Gemini (same order as qualifyLead in apps/api/src/services/qualification.ts): kill switch,
// then the reserve_ai_call quota. Gemini only runs when a reservation was granted.
let gate = null
let reservationId = null
if (!ctx.config.aiEnabled) {
  gate = { skipped: true, code: 'ai_disabled', message: 'AI qualification is disabled on this n8n instance (AI_ENABLED=false)' }
} else {
  const reserve = executed('Reserve AI Quota') ? httpResult($('Reserve AI Quota').first().json) : null
  const row = reserve && reserve.ok && Array.isArray(reserve.body) ? reserve.body[0] : null
  if (!reserve || !reserve.ok || !row) {
    // Fail closed: without a reservation Gemini is never called.
    gate = { code: 'quota_check_failed', message: `AI quota could not be checked, so Gemini was not called (${reserve ? reserve.error || 'no result' : 'not run'}).` }
  } else if (!row.allowed || !row.reservation_id) {
    const scope = row.reason === 'global_daily_limit' ? 'The daily AI limit for this server' : "This workspace's daily AI limit"
    gate = {
      code: 'quota_exceeded',
      message: `${scope} has been reached. It resets at 00:00 UTC.`,
      details: { reason: row.reason, workspaceUsed: row.workspace_used, globalUsed: row.global_used, retryAfterSeconds: secondsUntilUtcMidnight(aiCheckedAt) },
    }
  } else {
    reservationId = row.reservation_id
  }
}

const gemini = gate ? { ok: false, code: gate.code, message: gate.message } : readGemini($input.first().json)

let ai = null
let aiError = null
if (gemini.ok) {
  const parsed = parseAiQualification(gemini.text, AI_SETTINGS)
  if (parsed.ok) {
    const out = parsed.value
    const reconciled = reconcileScore(out.score, out.criteria, AI_SETTINGS.criteria, AI_SETTINGS.thresholds, out.priority, out.category)
    ai = {
      score: reconciled.score,
      priority: reconciled.priority,
      adjustments: reconciled.adjustments,
      category: out.category,
      summary: out.summary,
      reasoning: out.reasoning,
      recommendedAction: out.recommendedAction,
      confidence: Math.round(out.confidence * 1000) / 1000,
      criteria: out.criteria,
      qualificationStatus: qualificationOutcome(out.confidence, out.category, AI_SETTINGS.reviewConfidence),
      model: req.model,
      promptVersion: PROMPT_VERSION,
    }
  } else {
    const truncated = gemini.finishReason === 'MAX_TOKENS' ? ' The response was truncated (MAX_TOKENS).' : ''
    aiError = {
      code: 'invalid_response',
      message: truncate(`Gemini output failed validation: ${parsed.issues.slice(0, 5).join('; ')}.${truncated}`, 500),
    }
  }
} else {
  // Provider error text is echoed into the lead and execution, so it is scrubbed of anything key-like.
  aiError = { code: gemini.code, message: truncate(redact(gemini.message), 500) }
}
if (aiError) Object.assign(aiError, apiError(aiError.code, aiError.message))
if (aiError) aiError.apiMessage = truncate(aiError.apiMessage, 1000)

const aiFields = ai
  ? {
      score: ai.score,
      priority: ai.priority,
      category: ai.category,
      ai_summary: ai.summary,
      ai_reasoning: ai.reasoning,
      recommended_action: ai.recommendedAction,
      confidence: ai.confidence,
      qualification_status: ai.qualificationStatus,
      qualification_error: null,
      last_qualified_at: new Date(aiCheckedAt).toISOString(),
    }
  : { qualification_status: gate && gate.skipped ? 'skipped' : 'failed', qualification_error: aiError.apiMessage }

// Finalizes the pending ai_usage_events row exactly like the Worker (usageStatusFor in qualification.ts).
function usageStatus() {
  if (gemini.ok && ai) return 'success'
  const code = gemini.ok ? 'invalid_response' : gemini.code
  if (code === 'invalid_response' || code === 'blocked') return 'invalid_response'
  if (code === 'timeout') return 'timeout'
  return 'error'
}
const tokens = gemini.usage ?? null
const usagePatch = reservationId
  ? {
      status: usageStatus(),
      latency_ms: Math.max(0, aiCheckedAt - (req.marks.aiRequestBuiltAt ?? aiCheckedAt)),
      prompt_tokens: tokens ? tokens.promptTokens : null,
      output_tokens: tokens ? tokens.outputTokens : null,
      error_code: ai ? null : (gemini.ok ? 'invalid_response' : gemini.code),
    }
  : null

const lead = ctx.lead
const leadInsert = {
  workspace_id: ctx.config.workspaceId,
  name: lead.name,
  email: lead.email,
  phone: lead.phone,
  company: lead.company,
  job_title: lead.jobTitle,
  website: lead.website,
  source: 'n8n',
  message: lead.message,
  status: 'new',
  ...aiFields,
}
// Like the Worker, a repeat submission only replaces the inquiry message and bumps submission_count.
const leadPatch = req.existingLead
  ? { message: lead.message, submission_count: req.existingLead.submissionCount + 1, ...aiFields }
  : null

return [
  {
    json: {
      duplicate: req.duplicate,
      existingLeadId: req.existingLead ? req.existingLead.id : null,
      aiOk: ai !== null,
      aiSkipped: Boolean(gate && gate.skipped),
      ai,
      aiError,
      aiErrorDetails: gate && gate.details ? gate.details : null,
      reservationId,
      usagePatch,
      usage: gemini.usage ?? null,
      leadInsert,
      leadPatch,
      marks: { aiCheckedAt, scoredAt: Date.now() },
    },
  },
]
