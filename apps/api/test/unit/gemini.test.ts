import { DEFAULT_AI_SETTINGS, type LeadForPrompt } from '@leadpilot/shared'
import { describe, expect, it } from 'vitest'
import { geminiEndpoint, qualifyWithGemini, type GeminiOptions } from '../../src/services/gemini'

const API_KEY = 'AIzaSy-test-secret-key-0123456789'

const lead: LeadForPrompt = {
  email: 'cto@acme.example',
  company: 'Acme Logistics',
  jobTitle: 'CTO',
  website: 'https://acme.example',
  source: 'website_form',
  message: 'We need an AI assistant to triage support tickets. Budget around $25k, start next month.',
}

const validOutput = {
  score: 82,
  priority: 'high',
  category: 'ai_automation',
  summary: 'Wants an AI assistant for support ticket triage.',
  reasoning: 'Clear intent, strong fit, budget and timeline stated, decision maker.',
  recommendedAction: 'Schedule a discovery call',
  confidence: 0.86,
  criteria: [
    { key: 'intent', score: 23 },
    { key: 'fit', score: 23 },
    { key: 'budget_timeline', score: 16 },
    { key: 'authority', score: 12 },
    { key: 'completeness', score: 8 },
  ],
}

function geminiBody(text: string, extra: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: 'internal reasoning', thought: true }, { text }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 512, candidatesTokenCount: 140, thoughtsTokenCount: 20 },
    ...extra,
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const googleError = (code: number, status: string, message: string, details: unknown[] = []) =>
  json({ error: { code, status, message, details } }, code)

interface Recorded {
  url: string
  init: RequestInit
}

/** Fake fetch that serves the given responses in order (functions are called lazily). */
function fakeFetch(responses: (Response | (() => Promise<Response>) | Error)[]) {
  const calls: Recorded[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next()
    return next.clone()
  }) as typeof fetch
  return { impl, calls }
}

function options(fetchImpl: typeof fetch, extra: Partial<GeminiOptions> = {}) {
  const sleeps: number[] = []
  const opts: GeminiOptions = {
    apiKey: API_KEY,
    model: 'gemini-3.5-flash-lite',
    timeoutMs: 2000,
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...extra,
  }
  return { opts, sleeps }
}

const input = { lead, settings: DEFAULT_AI_SETTINGS }

describe('qualifyWithGemini', () => {
  it('parses a structured response, skips thought parts and reports usage', async () => {
    const { impl, calls } = fakeFetch([json(geminiBody(JSON.stringify(validOutput)))])
    const { opts } = options(impl)
    const outcome = await qualifyWithGemini(input, opts)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.output.score).toBe(82)
    expect(outcome.output.category).toBe('ai_automation')
    expect(outcome.attempts).toBe(1)
    expect(outcome.model).toBe('gemini-3.5-flash-lite')
    expect(outcome.usage).toEqual({ promptTokens: 512, outputTokens: 160 })
    expect(calls).toHaveLength(1)
  })

  it('sends the documented request shape with the key only in the x-goog-api-key header', async () => {
    const { impl, calls } = fakeFetch([json(geminiBody(JSON.stringify(validOutput)))])
    await qualifyWithGemini(input, options(impl).opts)

    const [{ url, init }] = calls
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(url).toBe(geminiEndpoint('gemini-3.5-flash-lite'))
    expect(url).not.toContain(API_KEY)
    expect(url).not.toContain('key=')
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('x-goog-api-key')).toBe(API_KEY)

    const body = JSON.parse(String(init.body))
    expect(body.systemInstruction.parts[0].text).toContain('SCORING RUBRIC')
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: expect.stringContaining('<lead>') }] }])
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
    })
    expect(body.generationConfig.responseJsonSchema.properties.category.enum).toEqual(DEFAULT_AI_SETTINGS.categories)
    expect(body.generationConfig).not.toHaveProperty('temperature')
    // Privacy: only the email domain is sent, never the address itself.
    expect(String(init.body)).not.toContain('cto@acme.example')
    expect(String(init.body)).toContain('acme.example')
  })

  it('accepts JSON wrapped in a markdown fence', async () => {
    const { impl } = fakeFetch([json(geminiBody('```json\n' + JSON.stringify(validOutput) + '\n```'))])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(true)
  })

  it('retries a 503 with backoff and then succeeds', async () => {
    const { impl, calls } = fakeFetch([
      googleError(503, 'UNAVAILABLE', 'The model is overloaded.'),
      json(geminiBody(JSON.stringify(validOutput))),
    ])
    const { opts, sleeps } = options(impl)
    const outcome = await qualifyWithGemini(input, opts)
    expect(outcome.ok).toBe(true)
    expect(outcome.attempts).toBe(2)
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([800])
  })

  it('gives up after maxAttempts 429s and reports rate_limited with a free-tier hint', async () => {
    const { impl, calls } = fakeFetch([googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded')])
    const { opts, sleeps } = options(impl)
    const outcome = await qualifyWithGemini(input, opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('rate_limited')
    expect(outcome.message).toMatch(/free-tier/i)
    expect(outcome.attempts).toBe(3)
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([800, 2000])
  })

  it('honours RetryInfo.retryDelay but caps it at 5s', async () => {
    const retryInfo = { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }
    const { impl } = fakeFetch([
      googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', [retryInfo]),
      json(geminiBody(JSON.stringify(validOutput))),
    ])
    const { opts, sleeps } = options(impl)
    const outcome = await qualifyWithGemini(input, opts)
    expect(outcome.ok).toBe(true)
    expect(sleeps).toEqual([5000])
  })

  it('honours a short Retry-After header', async () => {
    const { impl } = fakeFetch([
      new Response('busy', { status: 503, headers: { 'Retry-After': '3' } }),
      json(geminiBody(JSON.stringify(validOutput))),
    ])
    const { opts, sleeps } = options(impl)
    await qualifyWithGemini(input, opts)
    expect(sleeps).toEqual([3000])
  })

  it('does not retry when the daily free-tier quota is exhausted', async () => {
    const quotaFailure = {
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
    }
    const { impl, calls } = fakeFetch([googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', [quotaFailure])])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('rate_limited')
    expect(outcome.message).toMatch(/daily quota/i)
    expect(calls).toHaveLength(1)
  })

  it('times out when fetch never resolves', async () => {
    const { impl, calls } = fakeFetch([() => new Promise<Response>(() => {})])
    const { opts, sleeps } = options(impl, { timeoutMs: 20, maxAttempts: 2 })
    const outcome = await qualifyWithGemini(input, opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('timeout')
    expect(outcome.attempts).toBe(2)
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([800])
    // The per-attempt AbortSignal is passed to fetch and fired on timeout.
    expect(calls[0].init.signal?.aborted).toBe(true)
  })

  it('retries network errors and reports unavailable', async () => {
    const { impl, calls } = fakeFetch([new TypeError('fetch failed')])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('unavailable')
    expect(calls).toHaveLength(3)
  })

  it('maps 400 to bad_request without retrying', async () => {
    const { impl, calls } = fakeFetch([googleError(400, 'INVALID_ARGUMENT', 'Invalid JSON payload received.')])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('bad_request')
    expect(calls).toHaveLength(1)
  })

  it('maps 401/403 and API_KEY_INVALID to auth_error without retrying', async () => {
    for (const res of [
      googleError(403, 'PERMISSION_DENIED', 'Permission denied'),
      googleError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', [
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
      ]),
    ]) {
      const { impl, calls } = fakeFetch([res])
      const outcome = await qualifyWithGemini(input, options(impl).opts)
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.code).toBe('auth_error')
      expect(calls).toHaveLength(1)
    }
  })

  it('never echoes the API key, even if the provider error does', async () => {
    const { impl } = fakeFetch([googleError(400, 'INVALID_ARGUMENT', `Bad key ${API_KEY} supplied`)])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain(API_KEY)
  })

  it('reports invalid_response for text that is not JSON', async () => {
    const { impl } = fakeFetch([json(geminiBody('Sure! Here is my assessment: high priority.'))])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_response')
    expect(outcome.message).toMatch(/not valid JSON/)
    expect(outcome.usage).toEqual({ promptTokens: 512, outputTokens: 160 })
    expect(outcome.attempts).toBe(1)
    // The prompt is never echoed back.
    expect(outcome.message).not.toContain(lead.message)
  })

  it('reports invalid_response with the validation issues for schema-invalid output', async () => {
    const bad = { ...validOutput, score: 150, confidence: 2 }
    const { impl } = fakeFetch([json(geminiBody(JSON.stringify(bad)))])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_response')
    expect(outcome.message).toContain('score')
    expect(outcome.message).toContain('confidence')
    expect(outcome.message.length).toBeLessThanOrEqual(500)
  })

  it('rejects a category that is not configured for the workspace', async () => {
    const { impl } = fakeFetch([json(geminiBody(JSON.stringify({ ...validOutput, category: 'crypto_trading' })))])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_response')
    expect(outcome.message).toContain('crypto_trading')
  })

  it('reports blocked for promptFeedback.blockReason and SAFETY finish reasons', async () => {
    const promptBlocked = { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 40 } }
    const finishBlocked = { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }
    for (const body of [promptBlocked, finishBlocked]) {
      const { impl, calls } = fakeFetch([json(body)])
      const outcome = await qualifyWithGemini(input, options(impl).opts)
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.code).toBe('blocked')
      expect(calls).toHaveLength(1)
    }
  })

  it('reports invalid_response for a non-JSON 200 body', async () => {
    const { impl } = fakeFetch([new Response('<html>proxy error</html>', { status: 200 })])
    const outcome = await qualifyWithGemini(input, options(impl).opts)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_response')
  })
})
