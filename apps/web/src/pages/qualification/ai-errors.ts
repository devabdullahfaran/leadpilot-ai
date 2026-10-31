import { isApiClientError, errorMessage } from '@/lib/api-client'

export interface AiErrorExplanation {
  title: string
  description: string
  /** Where the viewer can fix it, as a mode-relative app path. */
  fixPath?: '/integrations' | '/settings'
  fixLabel?: string
}

// Specific copy per API error code; the API message is still shown alongside.
const EXPLANATIONS: Record<string, AiErrorExplanation> = {
  ai_disabled: {
    title: 'AI qualification is turned off',
    description: 'Either the server-wide AI switch or this workspace’s AI setting is disabled, so no model call was made.',
    fixPath: '/settings',
    fixLabel: 'Open AI settings',
  },
  ai_not_configured: {
    title: 'No AI provider configured',
    description: 'The server has no Gemini API key, so leads cannot be scored by AI. They can still be qualified manually.',
    fixPath: '/integrations',
    fixLabel: 'View integrations',
  },
  ai_quota_exceeded: {
    title: 'Daily AI quota reached',
    description: 'The daily limit of AI calls has been used up. The quota resets at UTC midnight.',
    fixPath: '/integrations',
    fixLabel: 'View usage',
  },
  ai_unavailable: {
    title: 'The AI provider did not respond',
    description: 'The model call failed or timed out. The failed run is recorded and can be retried.',
  },
  ai_invalid_response: {
    title: 'The AI returned an unusable answer',
    description: 'The model’s output did not match the expected schema, so no score was saved. The failed run is recorded and can be retried.',
  },
  rate_limited: {
    title: 'Too many AI runs in a short time',
    description: 'AI runs are limited per user per minute. Wait a moment and try again.',
  },
  conflict: {
    title: 'This run can’t be retried',
    description: 'Only failed or partial Worker executions with a lead can be retried, up to the maximum attempt count.',
  },
}

export function explainAiError(error: unknown): AiErrorExplanation & { message: string; code: string | null; retryAfter: number | null } {
  const code = isApiClientError(error) ? error.code : null
  const base = (code && EXPLANATIONS[code]) || { title: 'The run failed', description: 'No result was produced.' }
  return {
    ...base,
    message: errorMessage(error),
    code,
    retryAfter: isApiClientError(error) ? error.retryAfter : null,
  }
}

/** Toast copy: specific title plus the API's own message. */
export function aiErrorToast(error: unknown): { title: string; description: string } {
  const e = explainAiError(error)
  return { title: e.title, description: e.message }
}
