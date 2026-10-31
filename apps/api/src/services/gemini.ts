// STUB — signatures are the contract; implementation pending.
import type { AiQualificationOutput, AiSettings, LeadForPrompt } from '@leadpilot/shared'

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

/** Calls Gemini generateContent with structured JSON output and validates the result. Never throws. */
export async function qualifyWithGemini(
  input: { lead: LeadForPrompt; settings: AiSettings },
  options: GeminiOptions,
): Promise<GeminiOutcome> {
  void input; void options
  throw new Error('not implemented')
}
