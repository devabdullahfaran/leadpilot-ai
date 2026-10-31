import { aiSettingsSchema, type AiSettings } from '@leadpilot/shared'

export const REQUIRED_CATEGORIES = ['spam', 'other'] as const
export const CATEGORY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/
export const CONTEXT_MIN = 20
export const CONTEXT_MAX = 3000

export type FieldErrors = Record<string, string>

export function criteriaTotal(settings: Pick<AiSettings, 'criteria'>): number {
  return settings.criteria.reduce((sum, c) => sum + (Number.isFinite(c.maxPoints) ? c.maxPoints : 0), 0)
}

/** Validates a proposed category before it is added; returns an error message or null. */
export function categoryError(value: string, existing: string[]): string | null {
  if (!value) return 'Enter a category'
  if (!CATEGORY_PATTERN.test(value)) return 'Use lower_snake_case: start with a letter, 2–40 characters'
  if (existing.includes(value)) return 'Category already exists'
  if (existing.length >= 25) return 'At most 25 categories'
  return null
}

/** Runs aiSettingsSchema and flattens issues to dotted paths (first message per path). */
export function validateAiSettings(draft: AiSettings): { data: AiSettings; errors: null } | { data: null; errors: FieldErrors } {
  const parsed = aiSettingsSchema.safeParse(draft)
  if (parsed.success) return { data: parsed.data, errors: null }
  const errors: FieldErrors = {}
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.') || 'form'
    errors[path] ??= issue.message
  }
  return { data: null, errors }
}
