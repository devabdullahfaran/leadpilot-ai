import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  formatDate,
  formatDuration,
  formatEnumLabel,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
  initials,
  pluralize,
} from './format'

describe('formatDuration', () => {
  it('formats milliseconds, seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0 ms')
    expect(formatDuration(850)).toBe('850 ms')
    expect(formatDuration(1200)).toBe('1.2 s')
    expect(formatDuration(12_400)).toBe('12 s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(3_720_000)).toBe('1h 02m')
  })

  it('returns an em dash for missing or invalid input', () => {
    expect(formatDuration(null)).toBe(EMPTY)
    expect(formatDuration(undefined)).toBe(EMPTY)
    expect(formatDuration(-5)).toBe(EMPTY)
    expect(formatDuration(Number.NaN)).toBe(EMPTY)
  })
})

describe('formatEnumLabel', () => {
  it('humanizes snake_case values with acronym handling', () => {
    expect(formatEnumLabel('website_form')).toBe('Website form')
    expect(formatEnumLabel('needs_review')).toBe('Needs review')
    expect(formatEnumLabel('ai_automation')).toBe('AI automation')
    expect(formatEnumLabel('api')).toBe('API')
    expect(formatEnumLabel('linkedin')).toBe('LinkedIn')
  })

  it('uses explicit overrides', () => {
    expect(formatEnumLabel('n8n')).toBe('n8n')
    expect(formatEnumLabel('n8n_webhook')).toBe('n8n webhook')
    expect(formatEnumLabel('ai_classify')).toBe('AI classification')
    expect(formatEnumLabel('notify_slack')).toBe('Slack notification')
  })

  it('handles empty values', () => {
    expect(formatEnumLabel(null)).toBe(EMPTY)
    expect(formatEnumLabel('')).toBe(EMPTY)
  })
})

describe('numbers and percentages', () => {
  it('formats numbers with grouping and compact notation', () => {
    expect(formatNumber(12345)).toBe('12,345')
    expect(formatNumber(12345, { compact: true })).toBe('12.3K')
    expect(formatNumber(null)).toBe(EMPTY)
  })

  it('formats ratios as percentages', () => {
    expect(formatPercent(0.4235)).toBe('42%')
    expect(formatPercent(0.4235, 1)).toBe('42.4%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(null)).toBe(EMPTY)
  })

  it('pluralizes', () => {
    expect(pluralize(1, 'lead')).toBe('1 lead')
    expect(pluralize(1200, 'lead')).toBe('1,200 leads')
  })
})

describe('dates', () => {
  it('formats absolute dates and rejects invalid input', () => {
    expect(formatDate('2026-10-31T12:00:00Z')).toMatch(/^Oct 3[01], 2026$/)
    expect(formatDate('not a date')).toBe(EMPTY)
    expect(formatDate(null)).toBe(EMPTY)
  })

  it('reads date-only strings as calendar days', () => {
    expect(formatShortDate('2026-10-31')).toBe('Oct 31')
  })

  it('formats relative times', () => {
    const now = new Date('2026-10-31T12:00:00Z')
    expect(formatRelativeTime('2026-10-31T11:59:40Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-10-31T11:55:00Z', now)).toBe('5 minutes ago')
    expect(formatRelativeTime('2026-10-31T09:00:00Z', now)).toBe('3 hours ago')
    expect(formatRelativeTime('2026-10-30T12:00:00Z', now)).toBe('yesterday')
    expect(formatRelativeTime('2026-11-02T12:00:00Z', now)).toBe('in 2 days')
  })
})

describe('initials', () => {
  it('derives avatar initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('ada@example.com')).toBe('A')
    expect(initials('  ')).toBe('?')
    expect(initials(null)).toBe('?')
  })
})
