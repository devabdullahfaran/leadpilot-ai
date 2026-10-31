// The committed workflow JSON is in sync with the Code-node sources, and the validator catches the problems
// it is meant to catch.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { loadNodeCode, NODE_VERSIONS, serializeWorkflow, WORKFLOW_PATH } from '../build-workflow.mjs'
import { ALLOWED_NODE_VERSIONS, validateWorkflow } from '../validate-workflow.mjs'

const raw = readFileSync(WORKFLOW_PATH, 'utf8')
const workflow = JSON.parse(raw)
const clone = () => JSON.parse(raw)

const CODE_FILES = {
  'Validate & Normalize': 'validate-normalize.js',
  'Build Gemini Request': 'build-gemini-request.js',
  'Parse & Score': 'parse-and-score.js',
  'Prepare Lead Records': 'prepare-lead-records.js',
  'Prepare Notification': 'prepare-notification.js',
  'Check Slack Result': 'check-slack-result.js',
  'Build Execution Record': 'build-execution-record.js',
  'Finalize Response': 'finalize-response.js',
}

describe('workflow file', () => {
  test('committed JSON equals a fresh build', () => {
    assert.equal(raw, serializeWorkflow(), 'Run: node n8n/build-workflow.mjs')
  })

  test('every Code node embeds its source file', () => {
    const codeNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code')
    assert.deepEqual(codeNodes.map((n) => n.name).sort(), Object.keys(CODE_FILES).sort())
    for (const node of codeNodes) assert.equal(node.parameters.jsCode, loadNodeCode(CODE_FILES[node.name]))
  })

  test('build and validator agree on node versions', () => {
    for (const [type, version] of Object.entries(NODE_VERSIONS)) assert.deepEqual(ALLOWED_NODE_VERSIONS[type], [version])
  })

  test('workflow passes validation', () => {
    const result = validateWorkflow(workflow, raw)
    assert.deepEqual(result.errors, [])
  })

  test('key node settings', () => {
    const node = (name) => workflow.nodes.find((n) => n.name === name)
    const gemini = node('Gemini Classify')
    assert.equal(gemini.retryOnFail, true)
    assert.equal(gemini.maxTries, 3)
    assert.equal(gemini.waitBetweenTries, 2000)
    assert.equal(gemini.parameters.options.timeout, 20000)
    assert.deepEqual(gemini.parameters.options.response.response, { neverError: true, fullResponse: true })
    assert.equal(node('Slack Alert').onError, 'continueRegularOutput')
    assert.equal(node('Send Follow-up Email').disabled, true)
    assert.equal(node('Lead Intake Webhook').parameters.path, 'leadpilot-intake')
    assert.equal(node('Lead Intake Webhook').parameters.responseMode, 'responseNode')
    assert.equal(workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 4)
    for (const n of workflow.nodes) {
      for (const ref of Object.values(n.credentials ?? {})) assert.match(ref.id, /^REPLACE_ON_IMPORT/)
    }
  })
})

describe('validator', () => {
  const errorsFor = (mutate) => {
    const wf = clone()
    mutate(wf)
    return validateWorkflow(wf, JSON.stringify(wf)).errors.join('\n')
  }

  test('detects secrets', () => {
    const samples = [
      ['sb', '_secret_', 'abcdefghijklmnopqrstuv'].join(''),
      ['AI', 'za', 'Sy', 'A'.repeat(33)].join(''),
      ['https://hooks.slack.com/services/', 'T0123ABCD/B0123ABCD/abcdefabcdef'].join(''),
      ['ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZSJ9.abc'].join(''),
      ['Bea', 'rer abcdefghijklmnopqrstuvwxyz012345'].join(''),
    ]
    for (const secret of samples) {
      assert.match(errorsFor((wf) => (wf.nodes[0].parameters.content += secret)), /Possible secret/, secret.slice(0, 12))
    }
  })

  test('detects inline auth headers and missing credentials', () => {
    const errors = errorsFor((wf) => {
      const n = wf.nodes.find((x) => x.name === 'Create Lead')
      n.parameters.headerParameters.parameters.push({ name: 'apikey', value: 'x' })
      const g = wf.nodes.find((x) => x.name === 'Gemini Classify')
      delete g.credentials
      g.parameters.authentication = 'none'
    })
    assert.match(errors, /sets the auth header "apikey" inline/)
    assert.match(errors, /"Gemini Classify" calls Gemini without Header Auth/)
  })

  test('detects broken connections, duplicate names, bad versions and code syntax errors', () => {
    const errors = errorsFor((wf) => {
      wf.connections['Parse & Score'].main[0].push({ node: 'Ghost', type: 'main', index: 0 })
      wf.nodes.find((x) => x.name === 'Respond Rejected').name = 'Respond to Webhook'
      wf.nodes.find((x) => x.type === 'n8n-nodes-base.httpRequest').typeVersion = 4.1
      wf.nodes.find((x) => x.type === 'n8n-nodes-base.code').parameters.jsCode += '\nconst = 1'
    })
    assert.match(errors, /targets a missing node/)
    assert.match(errors, /Duplicate node name "Respond to Webhook"/)
    assert.match(errors, /typeVersion 4\.1/)
    assert.match(errors, /does not parse/)
  })
})
