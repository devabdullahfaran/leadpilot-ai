import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_SETTINGS } from '@leadpilot/shared'
import { categoryError, criteriaTotal, validateAiSettings } from './ai-settings-form'

describe('ai settings form helpers', () => {
  it('accepts the defaults', () => {
    expect(criteriaTotal(DEFAULT_AI_SETTINGS)).toBe(100)
    expect(validateAiSettings(DEFAULT_AI_SETTINGS).errors).toBeNull()
  })

  it('reports criteria total, thresholds and required categories', () => {
    const draft = {
      ...DEFAULT_AI_SETTINGS,
      categories: DEFAULT_AI_SETTINGS.categories.filter((c) => c !== 'spam'),
      criteria: DEFAULT_AI_SETTINGS.criteria.slice(1),
      thresholds: { high: 40, medium: 40 },
    }
    const { errors } = validateAiSettings(draft)
    expect(errors?.criteria).toMatch(/sum to 100/)
    expect(errors?.thresholds).toMatch(/greater than medium/)
    expect(errors?.categories).toMatch(/spam/)
  })

  it('flattens nested criterion errors', () => {
    const criteria = DEFAULT_AI_SETTINGS.criteria.map((c, i) => (i === 0 ? { ...c, key: 'Bad Key' } : c))
    expect(validateAiSettings({ ...DEFAULT_AI_SETTINGS, criteria }).errors?.['criteria.0.key']).toBe('Use lower_snake_case')
  })

  it('validates new categories', () => {
    expect(categoryError('New', [])).toMatch(/lower_snake_case/)
    expect(categoryError('spam', ['spam'])).toMatch(/exists/)
    expect(categoryError('events', ['spam'])).toBeNull()
  })
})
