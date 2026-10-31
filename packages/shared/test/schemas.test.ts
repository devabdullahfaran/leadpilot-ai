import { describe, expect, it } from 'vitest'
import { aiSettingsSchema, DEFAULT_AI_SETTINGS, intakeSchema, leadCreateSchema, qualificationOverrideSchema, slackSettingsSchema } from '../src/schemas'

describe('leadCreateSchema', () => {
  const base = { name: '  Ada  ', email: '  Ada@Example.COM ', company: ' Analytical ', message: '  Hello there  ' }

  it('trims fields, lower-cases the email and applies defaults', () => {
    const lead = leadCreateSchema.parse({ ...base, phone: '  ', website: '' })
    expect(lead).toMatchObject({
      name: 'Ada',
      email: 'ada@example.com',
      company: 'Analytical',
      message: 'Hello there',
      phone: null,
      website: null,
      jobTitle: null,
      source: 'manual',
      status: 'new',
    })
  })

  it('rejects invalid emails and blank required fields', () => {
    expect(leadCreateSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false)
    expect(leadCreateSchema.safeParse({ ...base, name: '   ' }).success).toBe(false)
    expect(leadCreateSchema.safeParse({ ...base, source: 'fax' }).success).toBe(false)
  })
})

describe('intakeSchema', () => {
  it('defaults the source to website_form and requires a 10+ char message', () => {
    const ok = intakeSchema.parse({ name: 'A', email: 'a@b.co', company: 'C', message: 'Need a new website soon' })
    expect(ok.source).toBe('website_form')
    expect(intakeSchema.safeParse({ name: 'A', email: 'a@b.co', company: 'C', message: 'hi' }).success).toBe(false)
  })
})

describe('aiSettingsSchema', () => {
  it('accepts the defaults', () => {
    expect(aiSettingsSchema.safeParse(DEFAULT_AI_SETTINGS).success).toBe(true)
  })

  it('requires criteria max points to sum to 100', () => {
    const criteria = DEFAULT_AI_SETTINGS.criteria.map((c, i) => (i === 0 ? { ...c, maxPoints: c.maxPoints + 1 } : c))
    const r = aiSettingsSchema.safeParse({ ...DEFAULT_AI_SETTINGS, criteria })
    expect(r.success).toBe(false)
    expect(r.error?.issues.map((i) => i.message)).toContain('Scoring criteria max points must sum to 100')
  })

  it('requires high > medium, spam/other categories and unique criterion keys', () => {
    expect(aiSettingsSchema.safeParse({ ...DEFAULT_AI_SETTINGS, thresholds: { high: 40, medium: 40 } }).success).toBe(false)
    expect(aiSettingsSchema.safeParse({ ...DEFAULT_AI_SETTINGS, categories: ['web_design', 'other'] }).success).toBe(false)
    const dup = [
      { key: 'intent', label: 'A', maxPoints: 50, description: 'a' },
      { key: 'intent', label: 'B', maxPoints: 50, description: 'b' },
    ]
    expect(aiSettingsSchema.safeParse({ ...DEFAULT_AI_SETTINGS, criteria: dup }).success).toBe(false)
  })
})

describe('other schemas', () => {
  it('slackSettingsSchema only accepts Slack incoming webhook URLs', () => {
    expect(slackSettingsSchema.safeParse({ enabled: true, webhookUrl: 'https://hooks.slack.com/services/T0/B0/xyz' }).success).toBe(true)
    expect(slackSettingsSchema.safeParse({ enabled: true, webhookUrl: 'https://evil.example/services/x' }).success).toBe(false)
    expect(slackSettingsSchema.parse({ enabled: false }).minPriority).toBe('high')
  })

  it('qualificationOverrideSchema requires an integer score and a reason', () => {
    expect(qualificationOverrideSchema.safeParse({ score: 50, priority: 'medium', reason: 'Spoke to them' }).success).toBe(true)
    expect(qualificationOverrideSchema.safeParse({ score: 50.5, priority: 'medium', reason: 'Spoke to them' }).success).toBe(false)
    expect(qualificationOverrideSchema.safeParse({ score: 50, priority: 'medium', reason: 'x' }).success).toBe(false)
  })
})
