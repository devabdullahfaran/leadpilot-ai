// Parity with the real packages/shared source. The shared package is TypeScript, so it is bundled on the fly
// with the esbuild already installed in the monorepo (no new dependency). Skips if esbuild is unavailable.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runCodeFile } from './harness.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/ai-outputs.json', import.meta.url), 'utf8'))
const leads = JSON.parse(readFileSync(new URL('./fixtures/leads.json', import.meta.url), 'utf8'))

let shared = null
let skipReason = null
let tmp = null

before(async () => {
  let esbuild
  try {
    esbuild = await import('esbuild')
  } catch {
    skipReason = 'esbuild is not installed (run npm install at the repo root)'
    return
  }
  tmp = mkdtempSync(join(tmpdir(), 'leadpilot-n8n-parity-'))
  const outfile = join(tmp, 'shared.mjs')
  await esbuild.build({
    entryPoints: [join(repoRoot, 'packages/shared/src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  })
  shared = await import(pathToFileURL(outfile).href)
})

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

const webhookItem = (body) => ({ headers: {}, params: {}, query: {}, body })

async function geminiRequestFor(body) {
  const v = await runCodeFile('validate-normalize.js', { input: webhookItem(body) })
  const g = await runCodeFile('build-gemini-request.js', { input: { statusCode: 200, body: [] }, nodes: { 'Validate & Normalize': v } })
  return { v, g }
}

async function n8nScore(output) {
  const { v, g } = await geminiRequestFor(leads.valid)
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  return runCodeFile('parse-and-score.js', {
    input: { statusCode: 200, body: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] } },
    nodes: {
      'Validate & Normalize': v,
      'Build Gemini Request': g,
      'Reserve AI Quota': { statusCode: 200, body: [{ reservation_id: 'dddddddd-0000-4000-8000-000000000004', allowed: true }] },
    },
  })
}

function sharedScore(output) {
  const settings = shared.DEFAULT_AI_SETTINGS
  const parsed = shared.parseAiQualification(typeof output === 'string' ? output : JSON.parse(JSON.stringify(output)), settings)
  if (!parsed.ok) return { ok: false }
  const o = parsed.value
  const r = shared.reconcileScore(o.score, o.criteria, settings.criteria, settings.thresholds, o.priority, o.category)
  return { ok: true, value: o, ...r, status: shared.qualificationOutcome(o.confidence, o.category, settings.reviewConfidence) }
}

// Small deterministic PRNG so the generated cases are reproducible.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('parity with packages/shared', () => {
  test('prompt, system instruction and response schema are identical', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (const body of [leads.valid, { ...leads.valid, jobTitle: undefined, website: undefined }]) {
      const { v, g } = await geminiRequestFor(body)
      const settings = shared.DEFAULT_AI_SETTINGS
      assert.equal(g.geminiRequest.systemInstruction.parts[0].text, shared.buildSystemInstruction(settings))
      assert.deepEqual(g.geminiRequest.generationConfig.responseJsonSchema, shared.buildResponseJsonSchema(settings))
      const lead = { email: v.lead.email, company: v.lead.company, jobTitle: v.lead.jobTitle, website: v.lead.website, source: 'n8n', message: v.lead.message }
      assert.equal(g.geminiRequest.contents[0].parts[0].text, shared.buildUserPrompt(lead))
    }
  })

  test('embedded AI settings equal DEFAULT_AI_SETTINGS and PROMPT_VERSION', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const out = await n8nScore(fixtures.fenced)
    assert.equal(out.ai.promptVersion, shared.PROMPT_VERSION)
    assert.equal(shared.SCORE_SUM_TOLERANCE, 5)
    const schema = (await geminiRequestFor(leads.valid)).g.geminiRequest.generationConfig.responseJsonSchema
    assert.deepEqual(schema.properties.category.enum, shared.DEFAULT_AI_SETTINGS.categories)
  })

  test('validation, reconcileScore and qualificationOutcome agree on fixtures and 400 generated outputs', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const random = rng(20261031)
    const pick = (list) => list[Math.floor(random() * list.length)]
    const keys = ['intent', 'fit', 'budget_timeline', 'authority', 'completeness', 'unknown_key']
    const cases = Object.values(fixtures)
    for (let i = 0; i < 400; i++) {
      const criteria = Array.from({ length: Math.floor(random() * 7) }, () => ({
        key: pick(keys),
        score: pick([0, 5, 12.6, 15, 20, 25, 30, -3, 101]),
        ...(random() < 0.2 ? { note: 'n' } : {}),
      }))
      cases.push({
        score: pick([0, 39, 40, 41, 55, 69, 70, 71, 85, 100, 99.6, 120, -1]),
        priority: pick(['high', 'medium', 'low', 'urgent']),
        category: pick(['software_development', 'spam', 'other', 'consulting', 'crypto']),
        summary: pick(['A summary.', '', 'x'.repeat(401)]),
        reasoning: 'Because.',
        recommendedAction: 'Call them',
        confidence: pick([0, 0.59, 0.6, 0.61, 1, 1.2]),
        criteria,
        extra: 'ignored',
      })
    }
    for (const output of cases) {
      const expected = sharedScore(output)
      const actual = await n8nScore(output)
      assert.equal(actual.aiOk, expected.ok, JSON.stringify(output))
      if (!expected.ok) continue
      assert.equal(actual.ai.score, expected.score)
      assert.equal(actual.ai.priority, expected.priority)
      assert.deepEqual(actual.ai.adjustments, expected.adjustments)
      assert.equal(actual.ai.qualificationStatus, expected.status)
      assert.deepEqual(actual.ai.criteria, expected.value.criteria)
    }
  })

  test('intake validation and normalization agree with intakeSchema and normalize.ts', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const base = leads.valid
    const variants = [
      base,
      leads.honeypot,
      leads.invalidEmail,
      leads.missingFields,
      { ...base, email: 'first.last@sub.example.co.uk' },
      { ...base, email: '.dot@example.com' },
      { ...base, email: 'a..b@example.com' },
      { ...base, email: 'name@example' },
      { ...base, email: "o'brien@example.ie" },
      { ...base, email: `${'a'.repeat(250)}@example.com` },
      { ...base, email: 42 },
      { ...base, name: '' },
      { ...base, name: '  Two   Spaces  ' },
      { ...base, name: null },
      { ...base, phone: 12345 },
      { ...base, phone: 'x'.repeat(41) },
      { ...base, phone: '  ' },
      { ...base, phone: '555-12' },
      { ...base, website: 'not a url' },
      { ...base, website: 'https://example.com/a b' },
      { ...base, source: undefined },
      { ...base, source: null },
      { ...base, source: 'n8n' },
      { ...base, message: '123456789' },
      { ...base, message: '          1234567890          ' },
      { ...base, hp: null },
      { ...base, hp: '   ' },
      { ...base, hp: 'filled', email: 'broken' },
      { ...base, hp: ' '.repeat(201) },
      { ...base, submissionId: 'short' },
      { ...base, submissionId: '  12345678  ' },
      { ...base, jobTitle: 'y'.repeat(121) },
      { ...base, company: 'c'.repeat(161) },
    ]
    for (const body of variants) {
      const actual = await runCodeFile('validate-normalize.js', { input: webhookItem(body) })
      const label = JSON.stringify(body).slice(0, 120)
      // The Worker route answers 202 for a filled honeypot before running intakeSchema.
      if (typeof body.hp === 'string' && body.hp.trim() !== '') {
        assert.equal(actual.outcome, 'honeypot', label)
        continue
      }
      const expected = shared.intakeSchema.safeParse(body)
      const actualOk = actual.httpStatus !== 422 && actual.httpStatus !== 400
      assert.equal(actualOk, expected.success, label)
      if (!expected.success) continue
      const d = expected.data
      assert.equal(actual.lead.email, shared.normalizeEmail(d.email), label)
      assert.equal(actual.lead.name, d.name, label)
      assert.equal(actual.lead.company, d.company, label)
      assert.equal(actual.lead.jobTitle, d.jobTitle, label)
      assert.equal(actual.lead.phone, d.phone, label)
      assert.equal(actual.lead.phoneNormalized, shared.normalizePhone(d.phone), label)
      // apps/api/src/services/intake.ts: normalized when parseable, otherwise kept as entered.
      assert.equal(actual.lead.website, d.website ? (shared.normalizeWebsite(d.website) ?? d.website) : null, label)
      assert.equal(actual.lead.submittedSource, d.source, label)
      assert.equal(actual.lead.message, d.message, label)
    }
  })
})
