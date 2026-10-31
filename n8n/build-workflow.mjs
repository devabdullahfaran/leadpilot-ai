#!/usr/bin/env node
// Assembles n8n/leadpilot-lead-qualification.workflow.json from the node template below and the Code-node
// sources in n8n/code (inlining `// @include lib/<file>.js` lines). No dependencies.
//   node n8n/build-workflow.mjs           write the workflow JSON
//   node n8n/build-workflow.mjs --check   exit 1 if the committed JSON is out of date
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const CODE_DIR = join(here, 'code')
export const WORKFLOW_PATH = join(here, 'leadpilot-lead-qualification.workflow.json')

/** Verified against n8n 2.45.7. validate-workflow.mjs enforces the same list. */
export const NODE_VERSIONS = {
  'n8n-nodes-base.webhook': 2.2,
  'n8n-nodes-base.respondToWebhook': 1.5,
  'n8n-nodes-base.code': 2,
  'n8n-nodes-base.if': 2.2,
  'n8n-nodes-base.httpRequest': 4.2,
  'n8n-nodes-base.emailSend': 2.1,
  'n8n-nodes-base.stickyNote': 1,
}

/** Returns the Code-node body with includes inlined, exactly as it is embedded in the workflow JSON. */
export function loadNodeCode(file) {
  const source = readFileSync(join(CODE_DIR, file), 'utf8')
  return source
    .replace(/^\/\/ @include (lib\/[a-z0-9-]+\.js)$/gm, (_, lib) => {
      const body = readFileSync(join(CODE_DIR, lib), 'utf8').trim()
      return `// ---- ${lib} (inlined by n8n/build-workflow.mjs) ----\n${body}\n// ---- end ${lib} ----`
    })
    .trimEnd()
}

// Deterministic UUID (v5 layout) per node name so rebuilding does not churn ids.
function stableId(seed) {
  const h = createHash('sha1').update(`leadpilot-n8n:${seed}`).digest('hex')
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// Credentials are referenced by placeholder id + descriptive name only. Select the real ones after import.
const SUPABASE_CREDENTIALS = {
  httpHeaderAuth: { id: 'REPLACE_ON_IMPORT_SUPABASE', name: 'LeadPilot Supabase secret key (apikey header)' },
}
const GEMINI_CREDENTIALS = {
  httpHeaderAuth: { id: 'REPLACE_ON_IMPORT_GEMINI', name: 'LeadPilot Gemini API key (x-goog-api-key header)' },
}
// The public webhook is protected like the Worker's intake key: n8n rejects requests without this header.
const WEBHOOK_CREDENTIALS = {
  httpHeaderAuth: { id: 'REPLACE_ON_IMPORT_WEBHOOK', name: 'LeadPilot webhook token (X-LeadPilot-Token header)' },
}
const SMTP_CREDENTIALS = { smtp: { id: 'REPLACE_ON_IMPORT_SMTP', name: 'LeadPilot SMTP (optional follow-up email)' } }

const CONFIG = "$('Validate & Normalize').first().json.config"
const LEAD = "$('Validate & Normalize').first().json.lead"
const REQUEST = "$('Build Gemini Request').first().json"
const SCORED = "$('Parse & Score').first().json"
const HTTP_RESPONSE_OPTIONS = { response: { response: { neverError: true, fullResponse: true } } }

function base(name, type, position, parameters, extra = {}) {
  return { parameters, id: stableId(name), name, type, typeVersion: NODE_VERSIONS[type], position, ...extra }
}

function codeNode(name, position, file) {
  return base(name, 'n8n-nodes-base.code', position, { jsCode: loadNodeCode(file) })
}

function ifNode(name, position, leftValue) {
  return base(name, 'n8n-nodes-base.if', position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: stableId(`${name}:condition`),
          leftValue,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  })
}

function params(list) {
  return { parameters: list.map(([name, value]) => ({ name, value })) }
}

function supabaseNode(name, position, { method, table, query = [], prefer, body }) {
  const parameters = {
    method,
    url: `={{ ${CONFIG}.supabaseUrl }}/rest/v1/${table}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
  }
  if (query.length > 0) Object.assign(parameters, { sendQuery: true, queryParameters: params(query) })
  const headers = [['Accept', 'application/json']]
  if (prefer) headers.push(['Prefer', prefer])
  Object.assign(parameters, { sendHeaders: true, headerParameters: params(headers) })
  if (body) Object.assign(parameters, { sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}` })
  parameters.options = { timeout: 10000, ...HTTP_RESPONSE_OPTIONS }
  return base(name, 'n8n-nodes-base.httpRequest', position, parameters, {
    credentials: SUPABASE_CREDENTIALS,
    onError: 'continueRegularOutput',
  })
}

function respondNode(name, position, codeExpr, bodyExpr) {
  return base(name, 'n8n-nodes-base.respondToWebhook', position, {
    respondWith: 'json',
    responseBody: `={{ JSON.stringify(${bodyExpr}) }}`,
    options: { responseCode: `={{ ${codeExpr} }}` },
  })
}

function sticky(name, position, width, height, color, content) {
  return base(name, 'n8n-nodes-base.stickyNote', position, { content, height, width, color })
}

const NOTE_OVERVIEW = `## LeadPilot AI · lead qualification (n8n)
Self-hosted twin of the LeadPilot Worker pipeline: **validate → deduplicate → Gemini → persist → Slack → execution log**. Writes the same tables and contracts; every run is recorded in \`workflow_executions\` with \`engine = 'n8n'\` and shows up on LeadPilot's Workflows page.

**n8n environment** (restart n8n after setting):
\`N8N_BLOCK_ENV_ACCESS_IN_NODE=false\` · \`LEADPILOT_WORKSPACE_ID\` · \`SUPABASE_URL\` · \`GEMINI_MODEL\` (default gemini-3.5-flash-lite) · \`AI_ENABLED\` (kill switch; \`false\` skips Gemini) · \`AI_DAILY_LIMIT_PER_WORKSPACE\` / \`AI_DAILY_LIMIT_GLOBAL\` (default 25 / 150, shared with the Worker via reserve_ai_call) · \`SLACK_WEBHOOK_URL\` (optional) · \`FOLLOWUP_FROM_EMAIL\` (optional)

Test: \`n8n/send-test-lead.sh\` → \`/webhook-test/leadpilot-intake\`. Full guide: \`docs/N8N.md\`.`

const NOTE_CREDENTIALS = `## Credentials (create in n8n, never in this file)
**Supabase** · Header Auth · Name \`apikey\` · Value: your \`sb_secret_…\` key. Used by every Supabase node. (Legacy JWT service keys need \`apikey\` **and** \`Authorization\`: use Custom Auth, see docs/N8N.md.)

**Gemini** · Header Auth · Name \`x-goog-api-key\` · Value: your Gemini API key.

**Webhook** · Header Auth · Name \`X-LeadPilot-Token\` · Value: a long random token. Required: callers send it on every request.

**SMTP** · only for the optional follow-up email.

The secret key bypasses Row Level Security: restrict who can open this n8n instance.`

const NOTE_FAILURES = `## Failure handling (same outcomes as the Worker)
* Gemini: 20 s timeout, Retry On Fail ×3 (2 s apart) for timeouts/network errors. HTTP errors (429/5xx/4xx) are returned to **Parse & Score**, which classifies them.
* Gemini only runs when \`AI_ENABLED\` is not \`false\` **and** \`reserve_ai_call\` grants a reservation (same daily limits as the Worker; fails closed). Disabled → lead saved as \`skipped\`; limit reached → \`429\`.
* AI failure → the lead is still saved with \`qualification_status = failed\` + error, execution **partial**, webhook **502** (\`429\` for provider quota).
* Lookup/save failure → execution **failed**, webhook **500**.
* Slack / email failure never fails the run → execution **partial**.`

const NOTE_EMAIL = `## Optional follow-up email
Disabled by default. To use it: create an SMTP credential, set \`FOLLOWUP_FROM_EMAIL\`, select the credential and enable the node. Sent only to high-priority leads.`

export function buildWorkflow() {
  const nodes = [
    sticky('Note: Overview', [-60, -260], 880, 460, 7, NOTE_OVERVIEW),
    sticky('Note: Credentials', [860, -260], 700, 460, 4, NOTE_CREDENTIALS),
    sticky('Note: Failure handling', [1600, -260], 760, 400, 3, NOTE_FAILURES),
    sticky('Note: Follow-up email', [4300, -160], 300, 300, 6, NOTE_EMAIL),
    base(
      'Lead Intake Webhook',
      'n8n-nodes-base.webhook',
      [0, 300],
      { httpMethod: 'POST', path: 'leadpilot-intake', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
      { webhookId: stableId('webhook:leadpilot-intake'), credentials: WEBHOOK_CREDENTIALS },
    ),
    codeNode('Validate & Normalize', [220, 300], 'validate-normalize.js'),
    ifNode('Valid Lead?', [440, 300], '={{ $json.valid }}'),
    respondNode('Respond Rejected', [660, 520], '$json.httpStatus', '$json.responseBody'),
    supabaseNode('Find Existing Lead', [660, 300], {
      method: 'GET',
      table: 'leads',
      query: [
        ['workspace_id', `=eq.{{ ${CONFIG}.workspaceId }}`],
        ['email_normalized', `=eq.{{ ${LEAD}.email }}`],
        ['select', 'id,submission_count'],
        ['limit', '1'],
      ],
    }),
    codeNode('Build Gemini Request', [880, 300], 'build-gemini-request.js'),
    ifNode('Lookup OK?', [1100, 300], '={{ $json.lookupOk }}'),
    ifNode('AI Enabled?', [1210, 300], `={{ ${CONFIG}.aiEnabled === true }}`),
    supabaseNode('Reserve AI Quota', [1320, 300], {
      method: 'POST',
      table: 'rpc/reserve_ai_call',
      body: `({ p_workspace_id: ${CONFIG}.workspaceId, p_user_id: null, p_lead_id: $json.existingLead ? $json.existingLead.id : null, p_model: $json.model, p_workspace_limit: ${CONFIG}.aiDailyLimitPerWorkspace, p_global_limit: ${CONFIG}.aiDailyLimitGlobal })`,
    }),
    ifNode(
      'AI Allowed?',
      [1430, 300],
      '={{ $json.statusCode === 200 && Array.isArray($json.body) && Boolean($json.body[0]) && $json.body[0].allowed === true && Boolean($json.body[0].reservation_id) }}',
    ),
    base(
      'Gemini Classify',
      'n8n-nodes-base.httpRequest',
      [1540, 300],
      {
        method: 'POST',
        url: `=https://generativelanguage.googleapis.com/v1beta/models/{{ ${REQUEST}.model }}:generateContent`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify(${REQUEST}.geminiRequest) }}`,
        options: { timeout: 20000, ...HTTP_RESPONSE_OPTIONS },
      },
      {
        credentials: GEMINI_CREDENTIALS,
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 2000,
        onError: 'continueRegularOutput',
      },
    ),
    codeNode('Parse & Score', [1650, 300], 'parse-and-score.js'),
    ifNode('AI Reserved?', [1700, 420], '={{ Boolean($json.reservationId) }}'),
    supabaseNode('Finalize AI Usage', [1730, 540], {
      method: 'PATCH',
      table: 'ai_usage_events',
      query: [
        ['id', `=eq.{{ ${SCORED}.reservationId }}`],
        ['workspace_id', `=eq.{{ ${CONFIG}.workspaceId }}`],
      ],
      prefer: 'return=minimal',
      body: `${SCORED}.usagePatch`,
    }),
    ifNode('Duplicate?', [1760, 300], `={{ ${SCORED}.duplicate }}`),
    supabaseNode('Update Lead', [1980, 180], {
      method: 'PATCH',
      table: 'leads',
      query: [
        ['id', `=eq.{{ ${SCORED}.existingLeadId }}`],
        ['workspace_id', `=eq.{{ ${CONFIG}.workspaceId }}`],
        ['select', 'id,submission_count'],
      ],
      prefer: 'return=representation',
      body: `${SCORED}.leadPatch`,
    }),
    supabaseNode('Create Lead', [1980, 420], {
      method: 'POST',
      table: 'leads',
      query: [['select', 'id,submission_count']],
      prefer: 'return=representation',
      body: `${SCORED}.leadInsert`,
    }),
    codeNode('Prepare Lead Records', [2200, 300], 'prepare-lead-records.js'),
    ifNode('Lead Saved?', [2420, 300], '={{ $json.leadSaved }}'),
    supabaseNode('Log Activity', [2640, 300], {
      method: 'POST',
      table: 'lead_activities',
      prefer: 'return=minimal',
      body: '$json.activities',
    }),
    ifNode('AI Succeeded?', [2860, 300], "={{ $('Prepare Lead Records').first().json.aiOk }}"),
    supabaseNode('Save Qualification', [3080, 300], {
      method: 'POST',
      table: 'lead_qualifications',
      prefer: 'return=minimal',
      body: "$('Prepare Lead Records').first().json.qualification",
    }),
    codeNode('Prepare Notification', [3300, 300], 'prepare-notification.js'),
    ifNode('High Priority?', [3520, 300], '={{ $json.isHighPriority }}'),
    ifNode('Slack Configured?', [3740, 200], '={{ $json.slackConfigured }}'),
    base(
      'Slack Alert',
      'n8n-nodes-base.httpRequest',
      [3960, 100],
      {
        method: 'POST',
        url: '={{ $env.SLACK_WEBHOOK_URL }}',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.slackMessage) }}',
        options: { timeout: 10000, ...HTTP_RESPONSE_OPTIONS },
      },
      { onError: 'continueRegularOutput' },
    ),
    codeNode('Check Slack Result', [4180, 200], 'check-slack-result.js'),
    base(
      'Send Follow-up Email',
      'n8n-nodes-base.emailSend',
      [4400, 200],
      {
        fromEmail: '={{ $env.FOLLOWUP_FROM_EMAIL }}',
        toEmail: "={{ $('Prepare Notification').first().json.followUp.to }}",
        subject: "={{ $('Prepare Notification').first().json.followUp.subject }}",
        emailFormat: 'text',
        text: "={{ $('Prepare Notification').first().json.followUp.text }}",
        options: { appendAttribution: false },
      },
      { credentials: SMTP_CREDENTIALS, disabled: true, onError: 'continueRegularOutput' },
    ),
    codeNode('Build Execution Record', [4620, 560], 'build-execution-record.js'),
    supabaseNode('Record Execution', [4840, 560], {
      method: 'POST',
      table: 'workflow_executions',
      query: [['select', 'id']],
      prefer: 'return=representation',
      body: '$json.executionRow',
    }),
    codeNode('Finalize Response', [5060, 560], 'finalize-response.js'),
    respondNode('Respond to Webhook', [5280, 560], '$json.httpStatus', '$json.body'),
  ]

  const connections = {}
  const connect = (from, to, output = 0) => {
    const main = (connections[from] ??= { main: [] }).main
    while (main.length <= output) main.push([])
    main[output].push({ node: to, type: 'main', index: 0 })
  }
  connect('Lead Intake Webhook', 'Validate & Normalize')
  connect('Validate & Normalize', 'Valid Lead?')
  connect('Valid Lead?', 'Find Existing Lead', 0)
  connect('Valid Lead?', 'Respond Rejected', 1)
  connect('Find Existing Lead', 'Build Gemini Request')
  connect('Build Gemini Request', 'Lookup OK?')
  connect('Lookup OK?', 'AI Enabled?', 0)
  connect('Lookup OK?', 'Build Execution Record', 1)
  connect('AI Enabled?', 'Reserve AI Quota', 0)
  connect('AI Enabled?', 'Parse & Score', 1)
  connect('Reserve AI Quota', 'AI Allowed?')
  connect('AI Allowed?', 'Gemini Classify', 0)
  connect('AI Allowed?', 'Parse & Score', 1)
  connect('Gemini Classify', 'Parse & Score')
  connect('Parse & Score', 'AI Reserved?')
  connect('AI Reserved?', 'Finalize AI Usage', 0)
  connect('AI Reserved?', 'Duplicate?', 1)
  connect('Finalize AI Usage', 'Duplicate?')
  connect('Duplicate?', 'Update Lead', 0)
  connect('Duplicate?', 'Create Lead', 1)
  connect('Update Lead', 'Prepare Lead Records')
  connect('Create Lead', 'Prepare Lead Records')
  connect('Prepare Lead Records', 'Lead Saved?')
  connect('Lead Saved?', 'Log Activity', 0)
  connect('Lead Saved?', 'Build Execution Record', 1)
  connect('Log Activity', 'AI Succeeded?')
  connect('AI Succeeded?', 'Save Qualification', 0)
  connect('AI Succeeded?', 'Build Execution Record', 1)
  connect('Save Qualification', 'Prepare Notification')
  connect('Prepare Notification', 'High Priority?')
  connect('High Priority?', 'Slack Configured?', 0)
  connect('High Priority?', 'Build Execution Record', 1)
  connect('Slack Configured?', 'Slack Alert', 0)
  connect('Slack Configured?', 'Check Slack Result', 1)
  connect('Slack Alert', 'Check Slack Result')
  connect('Check Slack Result', 'Send Follow-up Email')
  connect('Send Follow-up Email', 'Build Execution Record')
  connect('Build Execution Record', 'Record Execution')
  connect('Record Execution', 'Finalize Response')
  connect('Finalize Response', 'Respond to Webhook')

  return {
    name: 'LeadPilot AI · Lead Qualification',
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    pinData: {},
    meta: {},
    tags: [],
  }
}

export function serializeWorkflow(workflow = buildWorkflow()) {
  return `${JSON.stringify(workflow, null, 2)}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = serializeWorkflow()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(WORKFLOW_PATH, 'utf8')
    } catch {
      // missing file is reported below
    }
    if (current !== json) {
      console.error('✗ n8n/leadpilot-lead-qualification.workflow.json is out of date. Run: node n8n/build-workflow.mjs')
      process.exit(1)
    }
    console.log('✓ workflow JSON is up to date')
  } else {
    writeFileSync(WORKFLOW_PATH, json)
    const workflow = JSON.parse(json)
    const code = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code').length
    console.log(`✓ wrote ${WORKFLOW_PATH} (${workflow.nodes.length} nodes, ${code} Code nodes)`)
  }
}
