// Test helpers: run n8n Code-node bodies with mocked n8n globals, and simulate the whole workflow JSON
// (connections, IF branches, expressions) with mocked HTTP responses. This exercises the code and wiring;
// it is not n8n itself, so behaviour of real n8n nodes (retries, credentials) is out of scope.
import { readFileSync } from 'node:fs'
import { loadNodeCode, WORKFLOW_PATH } from '../build-workflow.mjs'

const AsyncFunction = (async () => {}).constructor

export const VALID_ENV = {
  LEADPILOT_WORKSPACE_ID: '11111111-2222-4333-8444-555555555555',
  SUPABASE_URL: 'https://example-project.supabase.co/',
  GEMINI_MODEL: '',
  SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/TEST/PLACEHOLDER/value',
  FOLLOWUP_FROM_EMAIL: 'sales@example.com',
}

export const blockedEnv = new Proxy(
  {},
  {
    get() {
      throw new Error('access to env vars denied')
    },
  },
)

function makeDollar(runData) {
  return (name) => ({
    get isExecuted() {
      return runData.has(name)
    },
    first() {
      if (!runData.has(name)) throw new Error(`Referenced node "${name}" has not been executed`)
      return { json: runData.get(name) }
    },
    all() {
      return runData.has(name) ? [{ json: runData.get(name) }] : []
    },
  })
}

/** Runs one Code-node body. `nodes` maps node name → output json of previously executed nodes. */
export async function runCode(code, { input = {}, env = VALID_ENV, nodes = {}, executionId = 'test-exec-1', hideUrl = false } = {}) {
  const runData = nodes instanceof Map ? nodes : new Map(Object.entries(nodes))
  const fn = new AsyncFunction('$input', '$env', '$', '$execution', 'URL', code)
  const $input = { first: () => ({ json: input }), all: () => [{ json: input }] }
  const result = await fn($input, env, makeDollar(runData), { id: executionId }, hideUrl ? undefined : URL)
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.json !== 'object') {
    throw new Error('Code node must return exactly one item [{ json }]')
  }
  return result[0].json
}

export function runCodeFile(file, options) {
  return runCode(loadNodeCode(file), options)
}

export function loadWorkflow() {
  return JSON.parse(readFileSync(WORKFLOW_PATH, 'utf8'))
}

// ---- Workflow simulation --------------------------------------------------------------------------------

function evaluate(value, scope) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value
  const text = value.slice(1)
  const run = (expr) => new Function('$json', '$', '$env', `return (${expr})`)(scope.$json, scope.$, scope.$env)
  const whole = /^\{\{([\s\S]*)\}\}$/.exec(text)
  if (whole && !whole[1].includes('}}')) return run(whole[1])
  return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => String(run(expr)))
}

/**
 * Executes the exported workflow for one webhook request. `http` maps HTTP node name → mocked response
 * item ({ statusCode, body } or { error }) or a function (request) => item. Returns the webhook response,
 * the run data and the evaluated HTTP requests.
 */
export async function simulateWorkflow({ body, env = VALID_ENV, http = {}, enableEmail = false, workflow = loadWorkflow() }) {
  const byName = new Map(workflow.nodes.map((n) => [n.name, n]))
  const runData = new Map()
  const requests = {}
  const $ = makeDollar(runData)
  let response = null
  const queue = [{ name: 'Lead Intake Webhook', item: { headers: {}, params: {}, query: {}, body } }]
  let guard = 0

  while (queue.length > 0) {
    if (++guard > 100) throw new Error('Simulation did not terminate')
    const { name, item } = queue.shift()
    const node = byName.get(name)
    const scope = { $json: item, $, $env: env }
    let outputs
    const disabled = node.disabled && !(enableEmail && node.type === 'n8n-nodes-base.emailSend')

    if (disabled) {
      outputs = [item]
    } else if (node.type === 'n8n-nodes-base.webhook') {
      outputs = [item]
    } else if (node.type === 'n8n-nodes-base.code') {
      outputs = [await runCode(node.parameters.jsCode, { input: item, env, nodes: runData })]
    } else if (node.type === 'n8n-nodes-base.if') {
      const cond = node.parameters.conditions.conditions[0]
      const left = evaluate(cond.leftValue, scope)
      if (typeof left !== 'boolean') throw new Error(`IF "${name}": strict type validation expects a boolean, got ${typeof left}`)
      outputs = left ? [item, null] : [null, item]
    } else if (node.type === 'n8n-nodes-base.httpRequest') {
      const p = node.parameters
      const request = {
        method: p.method,
        url: evaluate(p.url, scope),
        query: Object.fromEntries((p.queryParameters?.parameters ?? []).map((q) => [q.name, evaluate(q.value, scope)])),
        headers: Object.fromEntries((p.headerParameters?.parameters ?? []).map((h) => [h.name, evaluate(h.value, scope)])),
        body: p.sendBody ? JSON.parse(evaluate(p.jsonBody, scope)) : undefined,
      }
      requests[name] = request
      const mock = http[name]
      if (mock === undefined) throw new Error(`No mocked response for HTTP node "${name}"`)
      outputs = [typeof mock === 'function' ? mock(request) : mock]
    } else if (node.type === 'n8n-nodes-base.emailSend') {
      const p = node.parameters
      const message = { from: evaluate(p.fromEmail, scope), to: evaluate(p.toEmail, scope), subject: evaluate(p.subject, scope), text: evaluate(p.text, scope) }
      requests[name] = message
      const mock = http[name] ?? { accepted: [message.to], rejected: [], messageId: '<test@example.com>' }
      outputs = [typeof mock === 'function' ? mock(message) : mock]
    } else if (node.type === 'n8n-nodes-base.respondToWebhook') {
      if (response) throw new Error('Webhook responded twice')
      response = {
        node: name,
        status: evaluate(node.parameters.options.responseCode, scope),
        body: JSON.parse(evaluate(node.parameters.responseBody, scope)),
      }
      outputs = [item]
    } else {
      throw new Error(`Simulator does not support ${node.type}`)
    }

    if (runData.has(name)) throw new Error(`Node "${name}" ran twice`)
    runData.set(name, outputs.find((o) => o !== null) ?? item)
    const branches = workflow.connections[name]?.main ?? []
    branches.forEach((links, index) => {
      if (!outputs[index]) return
      for (const link of links) queue.push({ name: link.node, item: outputs[index] })
    })
  }
  return { response, runData, requests, executed: [...runData.keys()] }
}
