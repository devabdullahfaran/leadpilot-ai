import { z } from 'zod'
import {
  DEFAULT_PAGE_SIZE,
  EXECUTION_STATUSES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MAX_PAGE_SIZE,
  QUALIFICATION_STATUSES,
  SORTABLE_LEAD_FIELDS,
  WORKFLOW_ENGINES,
  WORKFLOW_KEYS,
} from './constants'
import { DEFAULT_PRIORITY_THRESHOLDS, DEFAULT_REVIEW_CONFIDENCE, DEFAULT_SCORING_CRITERIA } from './scoring'

const trimmed = (max: number) => z.string().trim().min(1).max(max)
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const leadCreateSchema = z.object({
  name: trimmed(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  phone: optionalTrimmed(40),
  company: trimmed(160),
  jobTitle: optionalTrimmed(120),
  website: optionalTrimmed(300),
  source: z.enum(LEAD_SOURCES).default('manual'),
  message: z.string().trim().min(1).max(5000),
  status: z.enum(LEAD_STATUSES).default('new'),
  ownerId: z.uuid().nullable().optional(),
})
export type LeadCreateInput = z.input<typeof leadCreateSchema>
export type LeadCreate = z.output<typeof leadCreateSchema>

/** Fields a user may edit. AI fields are deliberately absent; use the override endpoint instead. */
export const leadUpdateSchema = z
  .object({
    name: trimmed(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    phone: optionalTrimmed(40),
    company: trimmed(160),
    jobTitle: optionalTrimmed(120),
    website: optionalTrimmed(300),
    source: z.enum(LEAD_SOURCES),
    message: z.string().trim().min(1).max(5000),
    status: z.enum(LEAD_STATUSES),
    ownerId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' })
export type LeadUpdate = z.output<typeof leadUpdateSchema>

export const leadListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  qualificationStatus: z.enum(QUALIFICATION_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  ownerId: z.union([z.uuid(), z.literal('unassigned')]).optional(),
  sort: z.enum(SORTABLE_LEAD_FIELDS).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})
export type LeadListQuery = z.output<typeof leadListQuerySchema>

export const duplicateCheckQuerySchema = z
  .object({
    email: z.string().trim().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(160).optional(),
    excludeId: z.uuid().optional(),
  })
  .refine((v) => v.email || v.phone || v.company, { message: 'Provide email, phone or company' })

export const noteCreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
})

export const qualificationOverrideSchema = z.object({
  score: z.number().int().min(0).max(100),
  priority: z.enum(LEAD_PRIORITIES),
  category: z.string().trim().min(1).max(60).optional(),
  reason: z.string().trim().min(3).max(1000),
})
export type QualificationOverride = z.output<typeof qualificationOverrideSchema>

// ---------------------------------------------------------------------------
// Public webhook intake (website forms, n8n, other systems)
// ---------------------------------------------------------------------------

export const intakeSchema = z.object({
  name: trimmed(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  phone: optionalTrimmed(40),
  company: trimmed(160),
  jobTitle: optionalTrimmed(120),
  website: optionalTrimmed(300),
  source: z.enum(LEAD_SOURCES).default('website_form'),
  message: z.string().trim().min(10).max(5000),
  /** Honeypot. Real users never fill this hidden field; bots often do. */
  hp: z.string().max(200).optional(),
  /** Optional client-generated id used as an idempotency key when no header is sent. */
  submissionId: z.string().trim().min(8).max(100).optional(),
})
export type IntakeInput = z.input<typeof intakeSchema>
export type Intake = z.output<typeof intakeSchema>

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export const executionListQuerySchema = z.object({
  status: z.enum(EXECUTION_STATUSES).optional(),
  workflowKey: z.enum(WORKFLOW_KEYS).optional(),
  engine: z.enum(WORKFLOW_ENGINES).optional(),
  leadId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})
export type ExecutionListQuery = z.output<typeof executionListQuerySchema>

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
})

// ---------------------------------------------------------------------------
// Settings & integrations
// ---------------------------------------------------------------------------

export const scoringCriterionSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower_snake_case'),
  label: trimmed(60),
  maxPoints: z.number().int().min(1).max(100),
  description: trimmed(300),
})

export const aiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    autoQualifyOnIntake: z.boolean(),
    businessContext: z.string().trim().min(20).max(3000),
    categories: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/)).min(2).max(25),
    criteria: z.array(scoringCriterionSchema).min(1).max(10),
    thresholds: z.object({ high: z.number().int().min(2).max(100), medium: z.number().int().min(1).max(99) }),
    reviewConfidence: z.number().min(0).max(1),
  })
  .refine((s) => s.criteria.reduce((sum, c) => sum + c.maxPoints, 0) === 100, {
    message: 'Scoring criteria max points must sum to 100',
    path: ['criteria'],
  })
  .refine((s) => s.thresholds.high > s.thresholds.medium, {
    message: 'High threshold must be greater than medium threshold',
    path: ['thresholds'],
  })
  .refine((s) => s.categories.includes('spam') && s.categories.includes('other'), {
    message: 'Categories must include "spam" and "other"',
    path: ['categories'],
  })
  .refine((s) => new Set(s.criteria.map((c) => c.key)).size === s.criteria.length, {
    message: 'Criterion keys must be unique',
    path: ['criteria'],
  })
export type AiSettings = z.output<typeof aiSettingsSchema>

export const DEFAULT_BUSINESS_CONTEXT =
  'We are a small software studio that builds custom web applications, SaaS products, AI automations and integrations for small and mid-sized businesses. Typical projects range from $5,000 to $60,000 and take 4 to 16 weeks.'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  autoQualifyOnIntake: true,
  businessContext: DEFAULT_BUSINESS_CONTEXT,
  categories: [
    'software_development',
    'web_design',
    'mobile_app',
    'ai_automation',
    'data_analytics',
    'consulting',
    'support_request',
    'partnership',
    'job_application',
    'spam',
    'other',
  ],
  criteria: DEFAULT_SCORING_CRITERIA,
  thresholds: DEFAULT_PRIORITY_THRESHOLDS,
  reviewConfidence: DEFAULT_REVIEW_CONFIDENCE,
}

export const slackSettingsSchema = z.object({
  /** Only required when first configuring or rotating the webhook. Never returned by the API. */
  webhookUrl: z
    .string()
    .trim()
    .regex(/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/, 'Must be a Slack incoming webhook URL')
    .optional(),
  enabled: z.boolean(),
  minPriority: z.enum(LEAD_PRIORITIES).default('high'),
  channelLabel: z.string().trim().max(80).optional().nullable(),
})
export type SlackSettingsInput = z.input<typeof slackSettingsSchema>

export const workspaceUpdateSchema = z.object({
  name: trimmed(80),
})

export const profileUpdateSchema = z.object({
  fullName: trimmed(120),
})
