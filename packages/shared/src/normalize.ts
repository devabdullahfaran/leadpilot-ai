// Deterministic normalization used for duplicate detection and storage.
// The same rules are mirrored in the n8n "Validate & Normalize" Code node.

const WHITESPACE = /\s+/g

export function normalizeWhitespace(value: string): string {
  return value.replace(WHITESPACE, ' ').trim()
}

/** Lower-cased, trimmed email. Plus-addressing is kept: `a+b@x.com` and `a@x.com` can be different people. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Digits only, keeping a leading `+` when present. Returns null when fewer than
 * 7 digits remain, because short fragments are not useful for matching.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7) return null
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/** Adds https:// when the scheme is missing and strips trailing slashes. Returns null for unparseable input. */
export function normalizeWebsite(website: string | null | undefined): string | null {
  if (!website) return null
  const trimmed = website.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (!url.hostname.includes('.')) return null
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).toLowerCase()
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
])

export function isFreeEmailDomain(email: string): boolean {
  return FREE_EMAIL_DOMAINS.has(emailDomain(email))
}
