#!/usr/bin/env node
// Static checks for an exported n8n workflow. No dependencies.
//   node n8n/validate-workflow.mjs [path/to/workflow.json]
// Exits 1 when any check fails.
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { pathToFileURL } from 'node:url'

/** Node types and typeVersions verified against n8n 2.45.7 (keep in sync with build-workflow.mjs). */
export const ALLOWED_NODE_VERSIONS = {
  'n8n-nodes-base.webhook': [2.2],
  'n8n-nodes-base.respondToWebhook': [1.5],
  'n8n-nodes-base.code': [2],
  'n8n-nodes-base.if': [2.2],
  'n8n-nodes-base.httpRequest': [4.2],
  'n8n-nodes-base.emailSend': [2.1],
  'n8n-nodes-base.stickyNote': [1],
}

const REQUIRED_TOP_LEVEL = ['name', 'nodes', 'connections', 'settings', 'pinData', 'meta', 'active', 'tags']
const ON_ERROR_VALUES = ['continueErrorOutput', 'continueRegularOutput', 'stopWorkflow']
const AUTH_HEADER_NAMES = /^(apikey|authorization|x-goog-api-key|x-api-key)$/i

export const SECRET_PATTERNS = [
  { label: 'Supabase secret key (sb_secret_…)', re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: 'Google API key (AIza…)', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { label: 'Slack incoming webhook URL', re: /hooks\.slack\.com\/services\/T[A-Za-z0-9]{6,}/ },
  { label: 'JWT-looking token (eyJ…)', re: /eyJ[A-Za-z0-9_-]{15,}/ },
  { label: "'Bearer <token>' literal", re: /Bearer\s+[A-Za-z0-9._~+/-]{16,}/ },
  { label: 'Supabase legacy service key assignment', re: /service_role["']?\s*[:=]\s*["'][^"']{20,}/ },
]

function calledService(url) {
  if (typeof url !== 'string') return null
  if (/generativelanguage\.googleapis\.com/i.test(url)) return 'Gemini'
  if (/\/rest\/v1\/|supabase\.(co|in)|supabaseUrl/i.test(url)) return 'Supabase'
  return null
}

/** Returns { errors, warnings, checks } for a parsed workflow object and its raw JSON text. */
export function validateWorkflow(workflow, rawText = JSON.stringify(workflow)) {
  const errors = []
  const warnings = []
  const checks = []
  const check = (label, problems) => {
    checks.push({ label, ok: problems.length === 0 })
    errors.push(...problems)
  }

  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return { errors: ['Workflow must be a JSON object'], warnings, checks }
  }

  check(
    'required top-level keys',
    REQUIRED_TOP_LEVEL.filter((k) => !(k in workflow)).map((k) => `Missing top-level key "${k}"`),
  )
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : []
  if (!Array.isArray(workflow.nodes)) errors.push('"nodes" must be an array')
  const settingsProblems = []
  if (workflow.settings?.executionOrder !== 'v1') settingsProblems.push('settings.executionOrder must be "v1"')
  if (workflow.active !== false) settingsProblems.push('"active" must be false in an exported template')
  check('settings', settingsProblems)

  // Identity
  const idProblems = []
  const ids = new Set()
  const names = new Set()
  for (const node of nodes) {
    if (!node.id) idProblems.push(`Node "${node.name}" has no id`)
    else if (ids.has(node.id)) idProblems.push(`Duplicate node id ${node.id}`)
    ids.add(node.id)
    if (!node.name) idProblems.push(`Node ${node.id} has no name`)
    else if (names.has(node.name)) idProblems.push(`Duplicate node name "${node.name}"`)
    names.add(node.name)
    if (!Array.isArray(node.position) || node.position.length !== 2 || !node.position.every(Number.isFinite)) {
      idProblems.push(`Node "${node.name}" needs a numeric [x, y] position`)
    }
    if (!node.parameters || typeof node.parameters !== 'object') idProblems.push(`Node "${node.name}" has no parameters object`)
  }
  check('unique node ids and names', idProblems)

  // Types and versions
  const typeProblems = []
  for (const node of nodes) {
    const allowed = ALLOWED_NODE_VERSIONS[node.type]
    if (!allowed) typeProblems.push(`Node "${node.name}" uses unsupported type ${node.type}`)
    else if (!allowed.includes(node.typeVersion)) {
      typeProblems.push(`Node "${node.name}" (${node.type}) has typeVersion ${node.typeVersion}; allowed: ${allowed.join(', ')}`)
    }
    if (node.onError !== undefined && !ON_ERROR_VALUES.includes(node.onError)) {
      typeProblems.push(`Node "${node.name}" has invalid onError "${node.onError}"`)
    }
  }
  check('node types and typeVersions', typeProblems)

  // Connections
  const connectionProblems = []
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const targets = new Set()
  for (const [source, outputs] of Object.entries(workflow.connections ?? {})) {
    if (!byName.has(source)) connectionProblems.push(`Connection source "${source}" is not a node`)
    for (const [type, branches] of Object.entries(outputs ?? {})) {
      if (type !== 'main') connectionProblems.push(`Connection from "${source}" uses unsupported type "${type}"`)
      if (!Array.isArray(branches)) {
        connectionProblems.push(`Connections from "${source}" must be an array of outputs`)
        continue
      }
      const sourceNode = byName.get(source)
      if (sourceNode?.type === 'n8n-nodes-base.if' && branches.length > 2) {
        connectionProblems.push(`IF node "${source}" has more than two outputs`)
      }
      for (const branch of branches) {
        for (const link of branch ?? []) {
          if (!byName.has(link.node)) connectionProblems.push(`Connection "${source}" → "${link.node}" targets a missing node`)
          if (link.type !== 'main' || !Number.isInteger(link.index)) {
            connectionProblems.push(`Connection "${source}" → "${link.node}" must have type "main" and an integer index`)
          }
          targets.add(link.node)
        }
      }
    }
  }
  check('connections reference existing nodes', connectionProblems)

  // Webhook wiring
  const webhookProblems = []
  const webhooks = nodes.filter((n) => n.type === 'n8n-nodes-base.webhook')
  const responders = nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
  if (webhooks.length !== 1) webhookProblems.push(`Expected exactly one Webhook node, found ${webhooks.length}`)
  for (const hook of webhooks) {
    // The webhook creates leads and spends AI quota, so it must never be callable anonymously.
    if (!hook.parameters?.authentication || hook.parameters.authentication === 'none') {
      webhookProblems.push(`Webhook "${hook.name}" has no authentication; use Header Auth`)
    } else if (Object.keys(hook.credentials ?? {}).length === 0) {
      webhookProblems.push(`Webhook "${hook.name}" uses ${hook.parameters.authentication} but references no credential`)
    }
    if (hook.parameters?.responseMode === 'responseNode' && responders.length === 0) {
      webhookProblems.push('Webhook uses responseMode "responseNode" but there is no Respond to Webhook node')
    }
  }
  for (const node of nodes) {
    if (node.type === 'n8n-nodes-base.stickyNote' || node.type === 'n8n-nodes-base.webhook') continue
    if (!targets.has(node.name)) webhookProblems.push(`Node "${node.name}" is not connected to anything upstream`)
  }
  check('webhook, responders and reachability', webhookProblems)

  // Code nodes must parse (wrapped like n8n does: function body, top-level return/await allowed)
  const codeProblems = []
  for (const node of nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
    const code = node.parameters?.jsCode
    if (typeof code !== 'string' || !code.trim()) {
      codeProblems.push(`Code node "${node.name}" has no jsCode`)
      continue
    }
    if (/^\/\/ @include /m.test(code)) codeProblems.push(`Code node "${node.name}" contains an unresolved @include`)
    try {
      new Script(`(async function () {\n${code}\n})`, { filename: `${node.name}.js` })
    } catch (error) {
      codeProblems.push(`Code node "${node.name}" does not parse: ${error.message}`)
    }
  }
  check('Code nodes parse', codeProblems)

  // Credentials for Supabase/Gemini; no inline auth headers anywhere
  const credentialProblems = []
  for (const node of nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest')) {
    const p = node.parameters ?? {}
    for (const header of p.headerParameters?.parameters ?? []) {
      if (AUTH_HEADER_NAMES.test(String(header.name ?? ''))) {
        credentialProblems.push(`HTTP node "${node.name}" sets the auth header "${header.name}" inline; use a credential`)
      }
    }
    if (p.specifyHeaders === 'json' && /apikey|authorization|x-goog-api-key/i.test(String(p.jsonHeaders ?? ''))) {
      credentialProblems.push(`HTTP node "${node.name}" sets auth headers in JSON headers; use a credential`)
    }
    for (const q of p.queryParameters?.parameters ?? []) {
      if (/^(key|apikey|api_key)$/i.test(String(q.name ?? ''))) {
        credentialProblems.push(`HTTP node "${node.name}" sends an API key as query parameter "${q.name}"`)
      }
    }
    const service = calledService(p.url)
    if (!service) continue
    const types = Object.keys(node.credentials ?? {})
    if (p.authentication !== 'genericCredentialType' || !['httpHeaderAuth', 'httpCustomAuth'].includes(p.genericAuthType)) {
      credentialProblems.push(`HTTP node "${node.name}" calls ${service} without Header Auth / Custom Auth credentials`)
    } else if (!types.includes(p.genericAuthType)) {
      credentialProblems.push(`HTTP node "${node.name}" selects ${p.genericAuthType} but references no such credential`)
    }
  }
  for (const node of nodes) {
    for (const [type, ref] of Object.entries(node.credentials ?? {})) {
      const keys = Object.keys(ref ?? {}).sort().join(',')
      if (keys !== 'id,name') credentialProblems.push(`Node "${node.name}" credential ${type} must reference only {id, name}`)
    }
  }
  check('Supabase/Gemini calls use credentials', credentialProblems)

  // Secrets anywhere in the file (including sticky notes and pinData)
  const secretProblems = SECRET_PATTERNS.filter((p) => p.re.test(rawText)).map((p) => `Possible secret in workflow: ${p.label}`)
  if (workflow.pinData && Object.keys(workflow.pinData).length > 0) warnings.push('pinData is not empty; make sure it contains no real data')
  check('no secrets', secretProblems)

  return { errors, warnings, checks }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? new URL('./leadpilot-lead-qualification.workflow.json', import.meta.url).pathname
  let raw
  let workflow
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    console.error(`✗ cannot read ${file}: ${error.message}`)
    process.exit(1)
  }
  try {
    workflow = JSON.parse(raw)
  } catch (error) {
    console.error(`✗ invalid JSON: ${error.message}`)
    process.exit(1)
  }
  const { errors, warnings, checks } = validateWorkflow(workflow, raw)
  console.log(`Validating ${file}`)
  console.log('✓ valid JSON')
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.label}`)
  for (const w of warnings) console.log(`! ${w}`)
  if (errors.length > 0) {
    console.error(`\n${errors.length} problem(s):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const counts = {}
  for (const n of workflow.nodes) counts[n.type.replace('n8n-nodes-base.', '')] = (counts[n.type.replace('n8n-nodes-base.', '')] ?? 0) + 1
  console.log(`\nOK: ${workflow.nodes.length} nodes (${Object.entries(counts).map(([t, c]) => `${t} ×${c}`).join(', ')})`)
}
