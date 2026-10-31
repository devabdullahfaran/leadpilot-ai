import {
  buildResponseJsonSchema,
  buildSystemInstruction,
  buildUserPrompt,
  parseAiQualification,
  type AiQualificationOutput,
  type AiSettings,
  type LeadForPrompt,
} from '@leadpilot/shared'

export type GeminiErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'auth_error'
  | 'bad_request'
  | 'blocked'
  | 'invalid_response'

export interface GeminiUsage {
  promptTokens: number | null
  outputTokens: number | null
}

export type GeminiOutcome =
  | { ok: true; output: AiQualificationOutput; attempts: number; latencyMs: number; usage: GeminiUsage; model: string }
  | {
      ok: false
      code: GeminiErrorCode
      /** Safe to show to users. Never contains the API key or the prompt. */
      message: string
      attempts: number
      latencyMs: number
      usage: GeminiUsage | null
      model: string
    }

export interface GeminiOptions {
  apiKey: string
  model: string
  timeoutMs: number
  fetch: typeof fetch
  /** Total attempts including the first (default 3). Retries only timeouts, 429 and 5xx. */
  maxAttempts?: number
  /** Injected for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
}

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MAX_OUTPUT_TOKENS = 1024
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const BACKOFF_MS = [800, 2000]
const MAX_RETRY_DELAY_MS = 5000
const BLOCKED_FINISH_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'])

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function geminiEndpoint(model: string): string {
  return `${GEMINI_API_BASE}/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`
}

/** The exact request body sent to generateContent (exported for tests and the n8n workflow docs). */
export function buildGeminiRequest(input: { lead: LeadForPrompt; settings: AiSettings }) {
  return {
    systemInstruction: { parts: [{ text: buildSystemInstruction(input.settings) }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input.lead) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: buildResponseJsonSchema(input.settings),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
    },
  }
}

class AttemptTimeout extends Error {}

/** Races a promise against an abort signal, so a fetch that ignores the signal still times out. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AttemptTimeout('timeout'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

type AttemptResult =
  | { kind: 'response'; status: number; headers: Headers; text: string }
  | { kind: 'timeout' }
  | { kind: 'network' }

async function attemptOnce(url: string, body: string, options: GeminiOptions): Promise<AttemptResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const res = await raceAbort(
      options.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
        body,
        signal: controller.signal,
      }),
      controller.signal,
    )
    const text = await raceAbort(res.text(), controller.signal)
    return { kind: 'response', status: res.status, headers: res.headers, text }
  } catch (err) {
    if (err instanceof AttemptTimeout || controller.signal.aborted) return { kind: 'timeout' }
    return { kind: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: { '@type'?: string; retryDelay?: string; reason?: string; violations?: { quotaId?: string }[] }[]
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** RetryInfo.retryDelay ("12s", "1.5s") or Retry-After seconds, in ms. */
function serverRetryDelayMs(headers: Headers, err: GoogleErrorBody['error']): number | null {
  const info = err?.details?.find((d) => d['@type']?.endsWith('google.rpc.RetryInfo'))
  const m = info?.retryDelay ? /^(\d+(?:\.\d+)?)s$/.exec(info.retryDelay) : null
  if (m) return Math.round(Number(m[1]) * 1000)
  const header = headers.get('retry-after')
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.round(Number(header) * 1000)
  return null
}

/** Daily free-tier quota exhaustion will not clear within a retry window, so retrying only wastes time. */
function isDailyQuota(err: GoogleErrorBody['error']): boolean {
  return Boolean(
    err?.details?.some((d) => d['@type']?.endsWith('google.rpc.QuotaFailure') && d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? ''))),
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

interface Failure {
  code: GeminiErrorCode
  message: string
  retryable: boolean
  retryDelayMs?: number | null
  usage?: GeminiUsage | null
}

type Interpreted = { ok: true; output: AiQualificationOutput; usage: GeminiUsage } | ({ ok: false } & Failure)

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
}

function readUsage(body: GenerateContentResponse): GeminiUsage {
  const u = body.usageMetadata
  if (!u) return { promptTokens: null, outputTokens: null }
  const out = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)
  return {
    promptTokens: typeof u.promptTokenCount === 'number' ? u.promptTokenCount : null,
    outputTokens: u.candidatesTokenCount === undefined && u.thoughtsTokenCount === undefined ? null : out,
  }
}

function interpretError(status: number, headers: Headers, text: string): Failure {
  const err = (parseJson(text) as GoogleErrorBody | null)?.error
  const statusName = err?.status ? ` ${err.status}` : ''
  if (status === 401 || status === 403 || err?.details?.some((d) => d.reason === 'API_KEY_INVALID')) {
    return { code: 'auth_error', message: `Gemini rejected the API key (HTTP ${status}${statusName}). Check GEMINI_API_KEY.`, retryable: false }
  }
  if (status === 429) {
    const daily = isDailyQuota(err)
    return {
      code: 'rate_limited',
      message: daily
        ? 'Gemini free-tier daily quota is exhausted for this API key. Try again tomorrow or use a paid key.'
        : 'Gemini rate limit or free-tier quota reached (HTTP 429). Try again in a minute.',
      retryable: !daily,
      retryDelayMs: serverRetryDelayMs(headers, err),
    }
  }
  if (status >= 500) {
    return {
      code: 'unavailable',
      message: `Gemini is temporarily unavailable (HTTP ${status}${statusName}). Try again later.`,
      retryable: RETRYABLE_STATUSES.has(status),
      retryDelayMs: serverRetryDelayMs(headers, err),
    }
  }
  const detail = err?.message ? `: ${truncate(err.message, 200)}` : ''
  return { code: 'bad_request', message: `Gemini rejected the request (HTTP ${status}${statusName})${detail}`, retryable: false }
}

function interpretSuccess(text: string, settings: AiSettings): Interpreted {
  const body = parseJson(text) as GenerateContentResponse | null
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'invalid_response', message: 'Gemini returned a response body that was not JSON.', retryable: false }
  }
  const usage = readUsage(body)
  const blockReason = body.promptFeedback?.blockReason
  if (blockReason) {
    return { ok: false, code: 'blocked', message: `Gemini blocked the request (${blockReason}).`, retryable: false, usage }
  }
  const candidate = body.candidates?.[0]
  if (!candidate) {
    return { ok: false, code: 'invalid_response', message: 'Gemini returned no candidates.', retryable: false, usage }
  }
  const finishReason = candidate.finishReason ?? ''
  if (BLOCKED_FINISH_REASONS.has(finishReason)) {
    return { ok: false, code: 'blocked', message: `Gemini blocked the response (${finishReason}).`, retryable: false, usage }
  }
  const output = (candidate.content?.parts ?? [])
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
  if (!output.trim()) {
    const why = finishReason ? ` (finishReason ${finishReason})` : ''
    return { ok: false, code: 'invalid_response', message: `Gemini returned an empty response${why}.`, retryable: false, usage }
  }
  const parsed = parseAiQualification(output, settings)
  if (!parsed.ok) {
    const truncated = finishReason === 'MAX_TOKENS' ? ' The response was truncated (MAX_TOKENS).' : ''
    return {
      ok: false,
      code: 'invalid_response',
      message: truncate(`Gemini output failed validation: ${parsed.issues.slice(0, 5).join('; ')}.${truncated}`, 500),
      retryable: false,
      usage,
    }
  }
  return { ok: true, output: parsed.value, usage }
}

/** Calls Gemini generateContent with structured JSON output and validates the result. Never throws. */
export async function qualifyWithGemini(
  input: { lead: LeadForPrompt; settings: AiSettings },
  options: GeminiOptions,
): Promise<GeminiOutcome> {
  const started = Date.now()
  const model = options.model
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3))
  const sleep = options.sleep ?? defaultSleep
  // Defence in depth: whatever ends up in a message, the key never leaves this function.
  const scrub = (text: string) => (options.apiKey ? text.split(options.apiKey).join('[redacted]') : text)

  let attempts = 0
  let failure: Failure = { code: 'unavailable', message: 'Gemini request was not attempted.', retryable: false }
  try {
    const url = geminiEndpoint(model)
    const body = JSON.stringify(buildGeminiRequest(input))

    while (attempts < maxAttempts) {
      attempts++
      const res = await attemptOnce(url, body, options)
      if (res.kind === 'timeout') {
        failure = {
          code: 'timeout',
          message: `Gemini did not respond within ${Math.round(options.timeoutMs / 100) / 10}s.`,
          retryable: true,
        }
      } else if (res.kind === 'network') {
        failure = { code: 'unavailable', message: 'Could not reach the Gemini API (network error).', retryable: true }
      } else if (res.status >= 200 && res.status < 300) {
        const result = interpretSuccess(res.text, input.settings)
        if (result.ok) {
          return { ok: true, output: result.output, attempts, latencyMs: Date.now() - started, usage: result.usage, model }
        }
        failure = result
      } else {
        failure = interpretError(res.status, res.headers, res.text)
      }

      if (!failure.retryable || attempts >= maxAttempts) break
      const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
      await sleep(Math.min(MAX_RETRY_DELAY_MS, Math.max(backoff, failure.retryDelayMs ?? 0)))
    }
  } catch {
    // Only reachable through a bug (e.g. a prompt builder throwing); still honour "never throws".
    failure = { code: 'invalid_response', message: 'Failed to build or process the Gemini request.', retryable: false }
  }

  const suffix = attempts > 1 ? ` (${attempts} attempts)` : ''
  return {
    ok: false,
    code: failure.code,
    message: scrub(`${failure.message}${suffix}`),
    attempts,
    latencyMs: Date.now() - started,
    usage: failure.usage ?? null,
    model,
  }
}
