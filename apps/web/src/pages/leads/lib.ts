import { useEffect, useState } from 'react'
import type { Lead, LeadQualification, MemberSummary } from '@leadpilot/shared'
import { isApiClientError, errorMessage } from '@/lib/api-client'
import { formatEnumLabel } from '@/lib/format'

export interface Option {
  value: string
  label: string
}

export const enumOptions = (values: readonly string[]): Option[] =>
  values.map((value) => ({ value, label: formatEnumLabel(value) }))

/** Returns `raw` when it is one of `values`, otherwise undefined (ignores tampered URL params). */
export function parseEnum<T extends string>(values: readonly T[], raw: string | null): T | undefined {
  return raw && (values as readonly string[]).includes(raw) ? (raw as T) : undefined
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function memberLabel(member: MemberSummary): string {
  return member.fullName || member.email || 'Unnamed member'
}

/** Owner options from the member list, keeping the current owner even if they are not listed (e.g. preview). */
export function ownerOptions(members: MemberSummary[] | undefined, current: Lead['owner']): Option[] {
  const options = (members ?? []).map((m) => ({ value: m.userId, label: memberLabel(m) }))
  if (current && !options.some((o) => o.value === current.id)) {
    options.push({ value: current.id, label: current.fullName ?? 'Current owner' })
  }
  return options
}

/** Specific, honest explanations for AI pipeline errors. No result exists when any of these occur. */
export function aiErrorMessage(error: unknown): string {
  if (!isApiClientError(error)) return errorMessage(error)
  switch (error.code) {
    case 'ai_disabled':
      return 'AI qualification is turned off for this workspace or on the server. An admin can enable it in Settings. No score was produced.'
    case 'ai_not_configured':
      return 'AI is not configured on the server (no Gemini API key). No score was produced.'
    case 'ai_quota_exceeded':
      return `The daily AI quota has been reached${error.retryAfter ? `; try again in about ${Math.ceil(error.retryAfter / 60)} min` : ''}. No score was produced.`
    case 'ai_unavailable':
      return 'The AI provider did not respond. The failed run was recorded; try again in a moment.'
    case 'ai_invalid_response':
      return 'The AI returned a response that failed validation, so it was discarded. No score was saved.'
    case 'rate_limited':
      return `Too many AI runs in a short time${error.retryAfter ? `; wait ${error.retryAfter} s` : ''} and try again.`
    default:
      return error.message
  }
}

/** Why a lead was flagged for review, based on its latest qualification and the workspace threshold. */
export function reviewReason(lead: Lead, latest: LeadQualification | undefined, reviewConfidence: number | undefined): string {
  const category = latest?.category ?? lead.category
  if (category === 'spam') return 'The AI classified this inquiry as likely spam. Confirm before discarding or contacting it.'
  const confidence = latest?.confidence ?? lead.confidence
  if (confidence !== null && confidence !== undefined && reviewConfidence !== undefined && confidence < reviewConfidence) {
    return `The model's confidence (${Math.round(confidence * 100)}%) is below the workspace review threshold (${Math.round(reviewConfidence * 100)}%).`
  }
  return 'The AI result was flagged for a human check (low confidence or possible spam).'
}

export const PAGE_SIZES = [10, 25, 50]
