// Display formatters. All output is en-US; every function tolerates null/invalid input and returns '—'.

export const EMPTY = '—'

type DateInput = string | number | Date | null | undefined

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

/** "Oct 31, 2026" */
export function formatDate(value: DateInput): string {
  const d = toDate(value)
  return d ? dateFmt.format(d) : EMPTY
}

/** "Oct 31" — for chart axes and compact lists. Date-only strings (YYYY-MM-DD) are read as UTC days. */
export function formatShortDate(value: DateInput): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split('-').map(Number)
    return shortDateFmt.format(new Date(y, m - 1, day))
  }
  const d = toDate(value)
  return d ? shortDateFmt.format(d) : EMPTY
}

/** "Oct 31, 2026, 2:05 PM" */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value)
  return d ? dateTimeFmt.format(d) : EMPTY
}

/** "2:05 PM" */
export function formatTime(value: DateInput): string {
  const d = toDate(value)
  return d ? timeFmt.format(d) : EMPTY
}

const relativeFmt = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 hours ago", "yesterday", "just now". */
export function formatRelativeTime(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value)
  if (!d) return EMPTY
  const seconds = Math.round((d.getTime() - now.getTime()) / 1000)
  if (Math.abs(seconds) < 45) return 'just now'
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFmt.format(Math.round(seconds / size), unit)
  }
  return relativeFmt.format(Math.round(seconds / 60) || (seconds < 0 ? -1 : 1), 'minute')
}

/** Milliseconds → "850 ms", "1.2 s", "2m 05s", "1h 02m". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return EMPTY
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`
  const totalSeconds = Math.round(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

const numberFmt = new Intl.NumberFormat('en-US')
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** 12345 → "12,345"; with `compact`, "12.3K". */
export function formatNumber(value: number | null | undefined, options: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return options.compact ? compactFmt.format(value) : numberFmt.format(value)
}

/** Ratio 0–1 → "42%" / "42.5%" (`digits` decimals, trailing zeros trimmed). */
export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return EMPTY
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: digits }).format(ratio)
}

/** "4 leads" / "1 lead" */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

// ---------------------------------------------------------------------------
// Enum labels
// ---------------------------------------------------------------------------

const WORD_OVERRIDES: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  n8n: 'n8n',
  url: 'URL',
  crm: 'CRM',
  id: 'ID',
  linkedin: 'LinkedIn',
}

/** Whole-value labels where the generic rule reads badly. */
const LABEL_OVERRIDES: Record<string, string> = {
  n8n: 'n8n',
  n8n_webhook: 'n8n webhook',
  worker: 'Worker',
  ai_classify: 'AI classification',
  notify_slack: 'Slack notification',
  email_followup: 'Email follow-up',
  budget_timeline: 'Budget & timeline',
  rejected_quota: 'Rejected (quota)',
  rejected_disabled: 'Rejected (AI disabled)',
  web_form: 'Web form',
}

/** 'website_form' → 'Website form', 'ai_automation' → 'AI automation', 'needs_review' → 'Needs review'. */
export function formatEnumLabel(value: string | null | undefined): string {
  if (!value) return EMPTY
  if (value in LABEL_OVERRIDES) return LABEL_OVERRIDES[value]
  const words = value.split(/[_\s-]+/).filter(Boolean)
  return words
    .map((word, i) => {
      const lower = word.toLowerCase()
      if (lower in WORD_OVERRIDES) return WORD_OVERRIDES[lower]
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

/** Initials for avatars: "Ada Lovelace" → "AL", "ada@x.com" → "A". */
export function initials(name: string | null | undefined): string {
  const source = (name ?? '').trim()
  if (!source) return '?'
  const parts = source.includes('@') ? [source] : source.split(/\s+/)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0]
  return letters.toUpperCase()
}
