// node --test n8n/test/
// Executes the n8n Code-node sources against fixtures and checks the results follow the shared rules in
// packages/shared/src (expected values below are worked out from reconcileScore / qualificationOutcome).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, describe } from 'node:test'
import { blockedEnv, runCodeFile, simulateWorkflow, VALID_ENV } from './harness.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const leads = fixture('leads.json')
const aiOutputs = fixture('ai-outputs.json')

const webhookItem = (body) => ({ headers: {}, params: {}, query: {}, body })
const validate = (body, env = VALID_ENV) => runCodeFile('validate-normalize.js', { input: webhookItem(body), env })

function geminiOk(output, extra = {}) {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  return {
    statusCode: 200,
    headers: {},
    body: {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 164 },
      ...extra,
    },
  }
}

async function upstream(body = leads.valid, lookupBody = []) {
  const v = await validate(body)
  const g = await runCodeFile('build-gemini-request.js', {
    input: { statusCode: 200, headers: {}, body: lookupBody },
    nodes: { 'Validate & Normalize': v },
  })
  return { v, g }
}

const RESERVATION_ID = 'dddddddd-0000-4000-8000-000000000004'
const RESERVED = { statusCode: 200, headers: {}, body: [{ reservation_id: RESERVATION_ID, allowed: true, reason: null, workspace_used: 1, global_used: 1 }] }

async function parseAndScore(geminiItem, { lookupBody = [], reserve = RESERVED } = {}) {
  const { v, g } = await upstream(leads.valid, lookupBody)
  return runCodeFile('parse-and-score.js', {
    input: geminiItem,
    nodes: { 'Validate & Normalize': v, 'Build Gemini Request': g, 'Reserve AI Quota': reserve },
  })
}

// ---------------------------------------------------------------------------------------------------------
describe('Validate & Normalize', () => {
  test('valid lead is normalized like packages/shared/src/normalize.ts', async () => {
    const out = await validate(leads.valid)
    assert.equal(out.valid, true)
    assert.equal(out.httpStatus, 200)
    assert.equal(out.validateMessage, 'Submission is valid')
    assert.deepEqual(out.lead, {
      name: 'Dana Sample',
      email: 'dana.sample+leads@example.com',
      phone: '+1 (555) 010-2030',
      phoneNormalized: '+15550102030',
      company: 'Example Logistics Co',
      jobTitle: 'Head of Operations',
      website: 'https://example.com',
      submittedSource: 'landing_page',
      message: leads.valid.message,
      submissionId: 'sub-2026-10-31-0001',
    })
    assert.deepEqual(out.config, {
      workspaceId: VALID_ENV.LEADPILOT_WORKSPACE_ID,
      supabaseUrl: 'https://example-project.supabase.co',
      geminiModel: 'gemini-3.5-flash-lite',
      aiEnabled: true,
      aiDailyLimitPerWorkspace: 25,
      aiDailyLimitGlobal: 150,
      slackConfigured: true,
      slackSkipReason: null,
      followUpFromConfigured: true,
    })
    assert.ok(out.marks.validatedAt >= out.marks.startedAt)
  })

  test('honeypot submissions are accepted with 202 and not processed, even when otherwise invalid', async () => {
    for (const body of [leads.honeypot, { hp: 'x', email: 'nope' }]) {
      const out = await validate(body)
      assert.equal(out.valid, false)
      assert.equal(out.outcome, 'honeypot')
      assert.equal(out.httpStatus, 202)
      assert.deepEqual(out.responseBody, { accepted: true })
    }
  })

  test('an unparseable website is kept as entered, like the Worker', async () => {
    const out = await validate({ ...leads.valid, website: 'not a url' })
    assert.equal(out.lead.website, 'not a url')
    assert.match(out.validateMessage, /website kept as entered/)
  })

  test('invalid email is rejected with 422 validation_error', async () => {
    const out = await validate(leads.invalidEmail)
    assert.equal(out.httpStatus, 422)
    assert.equal(out.responseBody.error.code, 'validation_error')
    assert.deepEqual(out.responseBody.error.details, [{ path: 'email', message: 'Invalid email address' }])
  })

  test('reports every invalid field with intakeSchema limits', async () => {
    const out = await validate(leads.missingFields)
    assert.equal(out.httpStatus, 422)
    assert.deepEqual(
      out.responseBody.error.details.map((d) => d.path),
      ['name', 'company', 'source', 'message'],
    )
    const long = await validate({ ...leads.valid, name: 'x'.repeat(121), message: 'y'.repeat(5001), hp: ' '.repeat(201) })
    assert.deepEqual(
      long.responseBody.error.details.map((d) => d.path),
      ['name', 'message', 'hp'],
    )
    const edge = await validate({ ...leads.valid, name: 'x'.repeat(120), message: ` ${'y'.repeat(10)} `, phone: null, jobTitle: '' })
    assert.equal(edge.valid, true)
    assert.equal(edge.lead.phone, null)
    assert.equal(edge.lead.jobTitle, null)
  })

  test('non-object body is a 400 bad_request', async () => {
    const out = await validate(['not', 'an', 'object'])
    assert.equal(out.httpStatus, 400)
    assert.equal(out.responseBody.error.code, 'bad_request')
  })

  test('missing configuration answers 500 without leaking details to the caller', async () => {
    const out = await validate(leads.valid, { ...VALID_ENV, LEADPILOT_WORKSPACE_ID: 'not-a-uuid', SUPABASE_URL: '' })
    assert.equal(out.httpStatus, 500)
    assert.equal(out.outcome, 'config_error')
    assert.equal(out.configProblems.length, 2)
    assert.doesNotMatch(JSON.stringify(out.responseBody), /LEADPILOT_WORKSPACE_ID|SUPABASE_URL/)
  })

  test('blocked $env access is explained', async () => {
    const out = await validate(leads.valid, blockedEnv)
    assert.equal(out.httpStatus, 500)
    assert.match(out.configProblems[0], /N8N_BLOCK_ENV_ACCESS_IN_NODE=false/)
  })

  test('Slack is optional and a malformed SLACK_WEBHOOK_URL is not used', async () => {
    const unset = await validate(leads.valid, { ...VALID_ENV, SLACK_WEBHOOK_URL: '' })
    assert.equal(unset.config.slackConfigured, false)
    assert.equal(unset.config.slackSkipReason, 'SLACK_WEBHOOK_URL is not set')
    const bad = await validate(leads.valid, { ...VALID_ENV, SLACK_WEBHOOK_URL: 'https://evil.example.com/hook' })
    assert.equal(bad.config.slackConfigured, false)
  })

  test('website fallback (no URL global) matches WHATWG URL results for common inputs', async () => {
    const inputs = ['example.com', 'Example.com/', 'https://www.Example.com/path/', 'http://example.com:80/a?b=1#frag', 'example.com?x=1', 'localhost', 'https://example.com:8443']
    for (const website of inputs) {
      const body = { ...leads.valid, website }
      const withUrl = await runCodeFile('validate-normalize.js', { input: webhookItem(body) })
      const fallback = await runCodeFile('validate-normalize.js', { input: webhookItem(body), hideUrl: true })
      assert.equal(fallback.lead.website, withUrl.lead.website, website)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('Build Gemini Request', () => {
  test('sends email domain only, no name, and the structured-output schema', async () => {
    const { g } = await upstream()
    assert.equal(g.lookupOk, true)
    assert.equal(g.duplicate, false)
    assert.equal(g.model, 'gemini-3.5-flash-lite')
    const prompt = g.geminiRequest.contents[0].parts[0].text
    assert.match(prompt, /^Qualify this inbound lead\.\n<lead>\nemail_domain: example\.com\n/)
    assert.doesNotMatch(prompt, /Dana|dana\.sample/)
    const system = g.geminiRequest.systemInstruction.parts[0].text
    assert.match(system, /- intent \(0-25 points\) — Buying intent:/)
    assert.match(system, /PRIORITY: high if total >= 70; medium if total >= 40; otherwise low\./)
    const config = g.geminiRequest.generationConfig
    assert.equal(config.responseMimeType, 'application/json')
    assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'MINIMAL' })
    assert.deepEqual(config.responseJsonSchema.properties.criteria.items.properties.key.enum, ['intent', 'fit', 'budget_timeline', 'authority', 'completeness'])
  })

  test('detects a duplicate and a failed lookup', async () => {
    const dup = await upstream(leads.valid, [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', submission_count: 2 }])
    assert.equal(dup.g.duplicate, true)
    assert.deepEqual(dup.g.existingLead, { id: 'aaaaaaaa-0000-4000-8000-000000000001', submissionCount: 2 })
    const v = await validate(leads.valid)
    const failed = await runCodeFile('build-gemini-request.js', {
      input: { statusCode: 401, body: { message: 'Invalid API key' } },
      nodes: { 'Validate & Normalize': v },
    })
    assert.equal(failed.lookupOk, false)
    assert.match(failed.lookupError, /HTTP 401: Invalid API key/)
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('Parse & Score', () => {
  test('fenced JSON output is accepted; score within tolerance keeps the stated score', async () => {
    const out = await parseAndScore(geminiOk(aiOutputs.fenced))
    assert.equal(out.aiOk, true)
    assert.equal(out.ai.score, 82)
    assert.equal(out.ai.priority, 'high')
    assert.deepEqual(out.ai.adjustments, [])
    assert.equal(out.ai.qualificationStatus, 'completed')
    assert.equal(out.ai.promptVersion, 'lp-qualify-v1')
    assert.equal(out.ai.model, 'gemini-3.5-flash-lite')
    assert.deepEqual(out.ai.criteria[1], { key: 'fit', score: 22, note: 'Custom web app' })
    assert.deepEqual(out.usage, { promptTokens: 812, outputTokens: 164 })
    assert.equal(out.leadInsert.source, 'n8n')
    assert.equal(out.leadInsert.status, 'new')
    assert.equal(out.leadInsert.confidence, 0.86)
    assert.equal(out.leadInsert.qualification_status, 'completed')
    assert.equal(out.leadInsert.score, 82)
    assert.equal(out.leadInsert.workspace_id, VALID_ENV.LEADPILOT_WORKSPACE_ID)
    assert.equal(out.leadPatch, null)
  })

  test('inconsistent criteria sum: criterion total wins and priority follows the final score', async () => {
    const out = await parseAndScore(geminiOk(aiOutputs.inconsistentSum))
    assert.equal(out.ai.score, 50)
    assert.equal(out.ai.priority, 'medium')
    assert.deepEqual(out.ai.adjustments, [
      'Stated score 90 differed from criterion total 50; using criterion total.',
      'Model suggested "high" priority; score 50 maps to "medium".',
    ])
    assert.equal(out.ai.qualificationStatus, 'completed')
  })

  test('criterion scores are clamped to the rubric maximum and unknown criteria ignored', async () => {
    const out = await parseAndScore(geminiOk(aiOutputs.clampedAndUnknown))
    assert.equal(out.ai.score, 74)
    assert.equal(out.ai.priority, 'high')
    assert.deepEqual(out.ai.adjustments, [
      'Clamped "intent" from 30 to 25.',
      'Clamped "budget_timeline" from 12.4 to 12.',
      'Ignored unknown criterion "vibes".',
    ])
  })

  test('spam category forces low priority and needs_review', async () => {
    const out = await parseAndScore(geminiOk(aiOutputs.spam))
    assert.equal(out.ai.score, 75)
    assert.equal(out.ai.priority, 'low')
    assert.deepEqual(out.ai.adjustments, ['Category "spam" forces low priority.', 'Model suggested "high" priority; score 75 maps to "low".'])
    assert.equal(out.ai.qualificationStatus, 'needs_review')
  })

  test('confidence below 0.6 needs review', async () => {
    const out = await parseAndScore(geminiOk(aiOutputs.lowConfidence))
    assert.equal(out.ai.priority, 'medium')
    assert.equal(out.ai.qualificationStatus, 'needs_review')
  })

  test('invalid output becomes an aiError and the lead is marked failed', async () => {
    const unknown = await parseAndScore(geminiOk(aiOutputs.unknownCategory))
    assert.equal(unknown.aiOk, false)
    assert.equal(unknown.aiError.code, 'invalid_response')
    assert.equal(unknown.aiError.apiCode, 'ai_invalid_response')
    assert.equal(unknown.aiError.httpStatus, 502)
    assert.match(unknown.aiError.message, /^Gemini output failed validation: category: "blockchain" is not one of the configured categories\.$/)
    assert.equal(unknown.leadInsert.qualification_status, 'failed')
    assert.equal(unknown.leadInsert.qualification_error, unknown.aiError.apiMessage)
    assert.equal(unknown.leadInsert.score, undefined)

    const missing = await parseAndScore(geminiOk(aiOutputs.missingFields))
    assert.equal(missing.aiOk, false)
    assert.match(missing.aiError.message, /priority: expected one of high\|medium\|low; summary: too short/)

    const notJson = await parseAndScore(geminiOk('Sure! Here is the score: 80'))
    assert.match(notJson.aiError.message, /Response was not valid JSON/)
  })

  test('Gemini HTTP and transport failures are classified like GeminiErrorCode', async () => {
    const cases = [
      [{ statusCode: 429, body: { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } } }, 'rate_limited'],
      [{ statusCode: 403, body: { error: { code: 403, message: 'Permission denied' } } }, 'auth_error'],
      [{ statusCode: 404, body: { error: { code: 404, message: 'models/x is not found' } } }, 'bad_request'],
      [{ statusCode: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } } }, 'auth_error'],
      [{ statusCode: 503, body: { error: { code: 503, message: 'Overloaded' } } }, 'unavailable'],
      [{ error: { message: 'timeout of 20000ms exceeded' } }, 'timeout'],
      [{ error: 'getaddrinfo ENOTFOUND generativelanguage.googleapis.com' }, 'unavailable'],
      [{ statusCode: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }, 'blocked'],
      [{ statusCode: 200, body: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] } }, 'blocked'],
      [{ statusCode: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] } }, 'invalid_response'],
    ]
    for (const [item, code] of cases) {
      const out = await parseAndScore(item)
      assert.equal(out.aiOk, false, code)
      assert.equal(out.aiError.code, code)
      const apiCode = { rate_limited: 'ai_quota_exceeded', invalid_response: 'ai_invalid_response', blocked: 'ai_invalid_response' }[code] ?? 'ai_unavailable'
      assert.equal(out.aiError.apiCode, apiCode)
      assert.equal(out.aiError.httpStatus, code === 'rate_limited' ? 429 : 502)
      assert.equal(out.leadInsert.qualification_status, 'failed')
    }
  })

  test('error messages never echo API keys', async () => {
    const fakeKey = ['AI', 'za', 'Sy', 'X'.repeat(33)].join('')
    const out = await parseAndScore({ statusCode: 400, body: { error: { message: `Bad request for key ${fakeKey}` } } })
    assert.doesNotMatch(out.aiError.message, /AIza/)
    assert.match(out.aiError.message, /\[redacted\]/)
    const network = await parseAndScore({ error: { message: `connect failed for ${fakeKey}` } })
    assert.equal(network.aiError.message, 'Could not reach the Gemini API (network error).')
  })

  test('thought parts are ignored', async () => {
    const item = geminiOk(aiOutputs.inconsistentSum)
    item.body.candidates[0].content.parts.unshift({ text: 'thinking…', thought: true })
    const out = await parseAndScore(item)
    assert.equal(out.aiOk, true)
  })

  test('duplicates only replace the message and increment submission_count, like the Worker', async () => {
    const body = { ...leads.valid, phone: undefined, jobTitle: undefined }
    const v = await validate(body)
    const g = await runCodeFile('build-gemini-request.js', {
      input: { statusCode: 200, body: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', submission_count: 3 }] },
      nodes: { 'Validate & Normalize': v },
    })
    const out = await runCodeFile('parse-and-score.js', {
      input: geminiOk(aiOutputs.fenced),
      nodes: { 'Validate & Normalize': v, 'Build Gemini Request': g, 'Reserve AI Quota': RESERVED },
    })
    assert.equal(out.duplicate, true)
    assert.equal(out.existingLeadId, 'aaaaaaaa-0000-4000-8000-000000000001')
    assert.equal(out.leadPatch.submission_count, 4)
    assert.equal(out.leadPatch.message, leads.valid.message)
    assert.equal(out.leadPatch.qualification_status, 'completed')
    for (const key of ['name', 'email', 'phone', 'company', 'job_title', 'website', 'source', 'workspace_id']) {
      assert.equal(key in out.leadPatch, false, key)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------
const LEAD_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const EXECUTION_ID = 'cccccccc-0000-4000-8000-000000000003'
const STEP_KEYS = ['validate', 'deduplicate', 'ai_classify', 'persist', 'notify_slack', 'email_followup']

function mocks(overrides = {}) {
  return {
    'Find Existing Lead': { statusCode: 200, headers: {}, body: [] },
    'Reserve AI Quota': RESERVED,
    'Finalize AI Usage': { statusCode: 204, headers: {}, body: '' },
    'Gemini Classify': geminiOk(aiOutputs.fenced),
    'Create Lead': { statusCode: 201, headers: {}, body: [{ id: LEAD_ID, submission_count: 1 }] },
    'Update Lead': { statusCode: 200, headers: {}, body: [{ id: LEAD_ID, submission_count: 3 }] },
    'Log Activity': { statusCode: 201, headers: {}, body: '' },
    'Save Qualification': { statusCode: 201, headers: {}, body: '' },
    'Slack Alert': { statusCode: 200, headers: {}, body: 'ok' },
    'Record Execution': { statusCode: 201, headers: {}, body: [{ id: EXECUTION_ID }] },
    ...overrides,
  }
}

function stepMap(record) {
  return Object.fromEntries(record.executionRow.steps.map((s) => [s.key, s]))
}

function assertStepShape(steps) {
  assert.deepEqual(steps.map((s) => s.key), STEP_KEYS)
  for (const s of steps) {
    assert.ok(['succeeded', 'failed', 'skipped'].includes(s.status), s.key)
    assert.ok(!Number.isNaN(Date.parse(s.startedAt)), s.key)
    assert.ok(Number.isInteger(s.durationMs) && s.durationMs >= 0, s.key)
    for (const k of Object.keys(s)) assert.ok(['key', 'status', 'startedAt', 'durationMs', 'attempts', 'message'].includes(k), k)
  }
}

describe('Build Execution Record (full workflow simulation)', () => {
  test('high-priority lead: succeeded, Slack sent, email node disabled', async () => {
    const run = await simulateWorkflow({ body: leads.valid, http: mocks() })
    const record = run.runData.get('Build Execution Record')
    assert.equal(record.status, 'succeeded')
    assertStepShape(record.executionRow.steps)
    const steps = stepMap(record)
    assert.equal(steps.notify_slack.status, 'succeeded')
    assert.equal(steps.email_followup.status, 'skipped')
    assert.match(steps.email_followup.message, /disabled/)
    const row = record.executionRow
    assert.equal(row.workflow_key, 'lead_intake')
    assert.equal(row.engine, 'n8n')
    assert.equal(row.trigger, 'n8n_webhook')
    assert.equal(row.lead_id, LEAD_ID)
    assert.equal(row.error_code, null)
    assert.equal(row.duration_ms, Date.parse(row.finished_at) - Date.parse(row.started_at))
    assert.equal(row.result.n8nExecutionId, 'test-exec-1')
    assert.deepEqual(run.response, {
      node: 'Respond to Webhook',
      status: 200,
      body: { leadId: LEAD_ID, executionId: EXECUTION_ID, duplicate: false, qualificationStatus: 'completed', engine: 'n8n' },
    })

    // Requests carry the right data and no inline credentials.
    const create = run.requests['Create Lead']
    assert.equal(create.url, 'https://example-project.supabase.co/rest/v1/leads')
    assert.equal(create.body.source, 'n8n')
    assert.equal(create.body.priority, 'high')
    assert.equal(run.requests['Find Existing Lead'].query.email_normalized, 'eq.dana.sample+leads@example.com')
    assert.equal(run.requests['Gemini Classify'].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    const activities = run.requests['Log Activity'].body
    assert.deepEqual(activities.map((a) => a.type), ['lead_created', 'qualification_completed'])
    // PostgREST bulk inserts need identical keys on every row.
    assert.deepEqual(Object.keys(activities[0]).sort(), Object.keys(activities[1]).sort())
    const qualification = run.requests['Save Qualification'].body
    assert.equal(qualification.source, 'ai')
    assert.equal(qualification.lead_id, LEAD_ID)
    assert.equal(qualification.prompt_version, 'lp-qualify-v1')
    assert.equal(qualification.model, 'gemini-3.5-flash-lite')
    const slack = run.requests['Slack Alert']
    assert.equal(slack.url, VALID_ENV.SLACK_WEBHOOK_URL)
    const slackText = JSON.stringify(slack.body.blocks)
    assert.equal(slack.body.text, 'High priority lead: Dana Sample (Example Logistics Co), score 82/100')
    for (const fragment of ['Dana Sample', 'Example Logistics Co', '82/100', 'High', 'Schedule a discovery call this week', 'customer portal', 'confidence 86%']) {
      assert.ok(slackText.includes(fragment), fragment)
    }
    assert.equal(run.requests['Record Execution'].body.engine, 'n8n')
    for (const req of Object.values(run.requests)) {
      assert.equal(Object.keys(req.headers ?? {}).some((h) => /apikey|authorization|x-goog-api-key/i.test(h)), false)
    }
  })

  test('Gemini failure: lead still saved as failed, execution partial (like the Worker), webhook 502', async () => {
    const run = await simulateWorkflow({
      body: leads.valid,
      http: mocks({ 'Gemini Classify': { statusCode: 503, body: { error: { message: 'The model is overloaded.' } } } }),
    })
    const record = run.runData.get('Build Execution Record')
    assert.equal(record.status, 'partial')
    assert.equal(record.executionRow.error_code, 'ai_unavailable')
    assert.equal(record.executionRow.error_message, 'Gemini is temporarily unavailable (HTTP 503). Try again later.')
    assert.equal(run.requests['Create Lead'].body.qualification_status, 'failed')
    assert.equal(run.requests['Create Lead'].body.qualification_error, 'Gemini is temporarily unavailable (HTTP 503). Try again later.')
    assert.deepEqual(run.requests['Log Activity'].body.map((a) => a.type), ['lead_created', 'qualification_failed'])
    assert.equal(run.executed.includes('Save Qualification'), false)
    assert.equal(run.executed.includes('Slack Alert'), false)
    const steps = stepMap(record)
    assert.equal(steps.ai_classify.status, 'failed')
    assert.equal(steps.persist.status, 'succeeded')
    assert.equal(steps.notify_slack.status, 'skipped')
    assert.equal(steps.notify_slack.message, 'Not run: lead was not qualified')
    assert.equal(run.response.status, 502)
    assert.equal(run.response.body.error.code, 'ai_unavailable')
    assert.match(run.response.body.error.message, /^AI qualification failed: .* The lead was saved with qualification status "failed"\.$/)
    assert.deepEqual(run.response.body.error.details, {
      leadId: LEAD_ID,
      executionId: EXECUTION_ID,
      duplicate: false,
      qualificationStatus: 'failed',
      engine: 'n8n',
    })
  })

  test('Gemini quota exhaustion answers 429 ai_quota_exceeded', async () => {
    const run = await simulateWorkflow({
      body: leads.valid,
      http: mocks({ 'Gemini Classify': { statusCode: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } } } }),
    })
    assert.equal(run.response.status, 429)
    assert.equal(run.response.body.error.code, 'ai_quota_exceeded')
    assert.equal(run.runData.get('Build Execution Record').executionRow.error_code, 'ai_quota_exceeded')
  })

  test('Slack failure makes the execution partial but the webhook still answers 200', async () => {
    const run = await simulateWorkflow({
      body: leads.valid,
      http: mocks({ 'Slack Alert': { statusCode: 404, body: 'no_service' } }),
    })
    const record = run.runData.get('Build Execution Record')
    assert.equal(record.status, 'partial')
    assert.equal(record.executionRow.error_code, 'integration_failed')
    assert.equal(record.executionRow.error_message, 'Slack notification failed: Slack returned HTTP 404: no_service')
    assert.equal(stepMap(record).notify_slack.status, 'failed')
    assert.equal(run.response.status, 200)
  })

  test('medium priority skips Slack and email; duplicate updates the lead', async () => {
    const run = await simulateWorkflow({
      body: leads.valid,
      http: mocks({
        'Find Existing Lead': { statusCode: 200, body: [{ id: LEAD_ID, submission_count: 2 }] },
        'Gemini Classify': geminiOk(aiOutputs.inconsistentSum),
      }),
    })
    const record = run.runData.get('Build Execution Record')
    assert.equal(record.status, 'succeeded')
    assert.equal(run.executed.includes('Create Lead'), false)
    assert.equal(run.requests['Update Lead'].query.id, `eq.${LEAD_ID}`)
    assert.equal(run.requests['Update Lead'].body.submission_count, 3)
    assert.equal(run.requests['Log Activity'].body[0].type, 'duplicate_submission')
    assert.equal(stepMap(record).persist.message, 'Updated existing lead (submission #3) and saved qualification')
    const steps = stepMap(record)
    assert.equal(steps.notify_slack.status, 'skipped')
    assert.equal(steps.notify_slack.message, 'Priority medium is below the Slack threshold (high)')
    assert.equal(steps.email_followup.message, 'Only sent for high-priority leads')
    assert.equal(run.response.body.duplicate, true)
  })

  test('Slack not configured: alert skipped, run succeeded', async () => {
    const run = await simulateWorkflow({ body: leads.valid, env: { ...VALID_ENV, SLACK_WEBHOOK_URL: '' }, http: mocks() })
    const record = run.runData.get('Build Execution Record')
    assert.equal(run.executed.includes('Slack Alert'), false)
    assert.equal(stepMap(record).notify_slack.status, 'skipped')
    assert.equal(stepMap(record).notify_slack.message, 'SLACK_WEBHOOK_URL is not set')
    assert.equal(record.status, 'succeeded')
  })

  test('enabled follow-up email is recorded; an SMTP failure makes the run partial', async () => {
    const sent = await simulateWorkflow({ body: leads.valid, http: mocks(), enableEmail: true })
    assert.equal(stepMap(sent.runData.get('Build Execution Record')).email_followup.status, 'succeeded')
    assert.equal(sent.requests['Send Follow-up Email'].to, 'dana.sample+leads@example.com')
    assert.equal(sent.requests['Send Follow-up Email'].from, 'sales@example.com')
    const failed = await simulateWorkflow({
      body: leads.valid,
      http: mocks({ 'Send Follow-up Email': { error: { message: 'Invalid login: 535 Authentication failed' } } }),
      enableEmail: true,
    })
    const record = failed.runData.get('Build Execution Record')
    assert.equal(stepMap(record).email_followup.status, 'failed')
    assert.equal(record.status, 'partial')
  })

  test('lookup failure: nothing saved, execution failed, webhook 500', async () => {
    const run = await simulateWorkflow({ body: leads.valid, http: mocks({ 'Find Existing Lead': { error: 'connect ECONNREFUSED 127.0.0.1:443' } }) })
    const record = run.runData.get('Build Execution Record')
    assert.equal(run.executed.includes('Gemini Classify'), false)
    assert.equal(record.status, 'failed')
    assert.equal(record.executionRow.lead_id, null)
    assert.deepEqual(record.executionRow.steps.map((s) => s.status), ['succeeded', 'failed', 'skipped', 'skipped', 'skipped', 'skipped'])
    assert.equal(run.response.status, 500)
    assert.equal(run.response.body.error.code, 'internal_error')
  })

  test('lead insert failure (e.g. concurrent duplicate) fails the execution', async () => {
    const run = await simulateWorkflow({
      body: leads.valid,
      http: mocks({ 'Create Lead': { statusCode: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "leads_workspace_email_key"' } } }),
    })
    const record = run.runData.get('Build Execution Record')
    assert.equal(record.status, 'failed')
    assert.equal(stepMap(record).persist.status, 'failed')
    assert.match(stepMap(record).persist.message, /resubmit/)
    assert.equal(run.executed.includes('Log Activity'), false)
    assert.equal(run.response.status, 500)
  })

  test('qualification history insert failure is partial', async () => {
    const run = await simulateWorkflow({ body: leads.valid, http: mocks({ 'Save Qualification': { statusCode: 400, body: { message: 'bad' } } }) })
    const record = run.runData.get('Build Execution Record')
    assert.equal(record.status, 'partial')
    assert.equal(stepMap(record).persist.status, 'failed')
    assert.equal(run.response.status, 200)
  })

  test('execution insert failure still answers with the lead outcome', async () => {
    const run = await simulateWorkflow({ body: leads.valid, http: mocks({ 'Record Execution': { statusCode: 500, body: { message: 'boom' } } }) })
    assert.equal(run.response.status, 200)
    assert.equal('executionId' in run.response.body, false)
    assert.equal(run.runData.get('Finalize Response').executionRecorded, false)
  })

  test('rejected requests answer from "Respond Rejected" and touch nothing else', async () => {
    for (const [body, status] of [[leads.honeypot, 202], [leads.invalidEmail, 422]]) {
      const run = await simulateWorkflow({ body, http: {} })
      assert.equal(run.response.node, 'Respond Rejected')
      assert.equal(run.response.status, status)
      assert.deepEqual(run.executed, ['Lead Intake Webhook', 'Validate & Normalize', 'Valid Lead?', 'Respond Rejected'])
    }
  })
})

// ---------------------------------------------------------------------------------------------------------
// Security review regressions: the n8n path honours the Worker's kill switch and daily AI quota, and the
// webhook cannot be called anonymously.
describe('AI cost protection parity with the Worker', () => {
  test('Parse & Score fails closed when the quota reservation did not run or failed', async () => {
    const missing = await runCodeFile('parse-and-score.js', {
      input: geminiOk(aiOutputs.fenced),
      nodes: { 'Validate & Normalize': (await upstream()).v, 'Build Gemini Request': (await upstream()).g },
    })
    assert.equal(missing.aiOk, false)
    assert.equal(missing.reservationId, null)
    const failed = await parseAndScore(geminiOk(aiOutputs.fenced), { reserve: { statusCode: 401, headers: {}, body: { message: 'bad key' } } })
    assert.equal(failed.aiOk, false)
    assert.equal(failed.leadInsert.qualification_status, 'failed')
  })

  test('AI_ENABLED=false skips Gemini and the quota, saves the lead as skipped and succeeds', async () => {
    const run = await simulateWorkflow({ body: leads.valid, env: { ...VALID_ENV, AI_ENABLED: 'false' }, http: mocks() })
    assert.equal(run.executed.includes('Reserve AI Quota'), false)
    assert.equal(run.executed.includes('Gemini Classify'), false)
    assert.equal(run.requests['Create Lead'].body.qualification_status, 'skipped')
    const record = run.runData.get('Build Execution Record')
    assert.equal(record.status, 'succeeded')
    assert.equal(stepMap(record).ai_classify.status, 'skipped')
    assert.equal(run.response.status, 200)
    assert.equal(run.response.body.qualificationStatus, 'skipped')
  })

  test('a quota rejection never calls Gemini and answers 429 ai_quota_exceeded', async () => {
    const run = await simulateWorkflow({
      body: leads.valid,
      http: mocks({
        'Reserve AI Quota': { statusCode: 200, headers: {}, body: [{ reservation_id: null, allowed: false, reason: 'workspace_daily_limit', workspace_used: 25, global_used: 30 }] },
      }),
    })
    assert.equal(run.executed.includes('Gemini Classify'), false)
    assert.equal(run.executed.includes('Finalize AI Usage'), false)
    assert.equal(run.requests['Create Lead'].body.qualification_status, 'failed')
    assert.equal(run.response.status, 429)
    assert.equal(run.response.body.error.code, 'ai_quota_exceeded')
    assert.equal(run.response.body.error.quota.reason, 'workspace_daily_limit')
  })

  test('the reservation uses the configured limits and is finalized with the outcome', async () => {
    const run = await simulateWorkflow({ body: leads.valid, env: { ...VALID_ENV, AI_DAILY_LIMIT_PER_WORKSPACE: '7' }, http: mocks() })
    const reserve = run.requests['Reserve AI Quota']
    assert.match(reserve.url, /\/rest\/v1\/rpc\/reserve_ai_call$/)
    assert.equal(reserve.body.p_workspace_limit, 7)
    assert.equal(reserve.body.p_global_limit, 150)
    assert.equal(reserve.body.p_workspace_id, VALID_ENV.LEADPILOT_WORKSPACE_ID)
    const finalize = run.requests['Finalize AI Usage']
    assert.equal(finalize.method, 'PATCH')
    assert.equal(finalize.query.id, `eq.${RESERVATION_ID}`)
    assert.equal(finalize.body.status, 'success')

    const failed = await simulateWorkflow({
      body: leads.valid,
      http: mocks({ 'Gemini Classify': { statusCode: 503, body: { error: { message: 'overloaded' } } } }),
    })
    assert.equal(failed.requests['Finalize AI Usage'].body.status, 'error')
    assert.equal(failed.requests['Finalize AI Usage'].body.error_code, 'unavailable')
  })

  test('an invalid AI limit is a configuration error', async () => {
    const out = await validate(leads.valid, { ...VALID_ENV, AI_DAILY_LIMIT_GLOBAL: '-1' })
    assert.equal(out.valid, false)
    assert.ok(out.configProblems.some((p) => p.includes('AI_DAILY_LIMIT_GLOBAL')))
  })
})
