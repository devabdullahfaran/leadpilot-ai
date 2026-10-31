// Synthetic sample dataset for the portfolio preview and the "Load sample data" setting.
//
// Everything here is invented: people, companies and messages are fictional, emails use reserved
// domains (*.example / example.com|org|net), phones are in the fictional 555-01xx range. Qualification
// records are hand-written fixtures, NOT model output, so they carry model = 'sample-data'.
// Every materialized row has is_sample = true.
//
// Only type imports are used so scripts/generate-seed.ts can load this file with
// `node --experimental-strip-types` (relative runtime imports would need explicit .ts extensions).
import type {
  ActivityType,
  ExecutionStatus,
  ExecutionStepKey,
  LeadPriority,
  LeadSource,
  LeadStatus,
  NotificationStatus,
  QualificationSource,
  QualificationStatus,
  StepStatus,
  WorkflowEngine,
  WorkflowKey,
  WorkflowTrigger,
} from './constants'
import type { CriterionResult, ExecutionStep } from './types'

/** Marker stored in lead_qualifications.model for fixtures, so they can never be mistaken for AI output. */
export const SAMPLE_DATA_MODEL = 'sample-data'

/** The single public, read-only preview workspace created by supabase/seed.sql. */
export const DEMO_WORKSPACE = {
  id: '0d3e0000-0000-4000-8000-000000000001',
  slug: 'leadpilot-demo',
  name: 'LeadPilot Demo (sample data)',
} as const

// ---------------------------------------------------------------------------
// Fixture specs (relative time, no ids)
// ---------------------------------------------------------------------------

/** Points per DEFAULT_SCORING_CRITERIA key: intent, fit, budget_timeline, authority, completeness. */
export type SampleCriteria = [intent: number, fit: number, budgetTimeline: number, authority: number, completeness: number]

export const SAMPLE_CRITERIA_KEYS = ['intent', 'fit', 'budget_timeline', 'authority', 'completeness'] as const

export interface SampleQualificationSpec {
  criteria: SampleCriteria
  /** Must equal priorityFromScore(sum(criteria)) with the default thresholds (checked by the seed generator and tests). */
  priority: LeadPriority
  /** One of DEFAULT_AI_SETTINGS.categories. */
  category: string
  confidence: number
  /** needs_review when confidence < DEFAULT_REVIEW_CONFIDENCE or category is spam (see qualificationOutcome). */
  outcome: 'completed' | 'needs_review'
  summary: string
  reasoning: string
  recommendedAction: string
}

/** What happened in the AI step of a run. A qualification spec means the step succeeded. */
export type SampleAiOutcome = SampleQualificationSpec | 'unavailable' | 'invalid_response' | 'quota' | 'disabled'

export interface SampleRunSpec {
  workflowKey: Extract<WorkflowKey, 'lead_intake' | 'lead_qualification'>
  engine: WorkflowEngine
  trigger: WorkflowTrigger
  /** Hours after the lead was created. */
  atHours: number
  ai: SampleAiOutcome
  /** Slack delivery. 'below' = priority under the alert threshold, so the step is skipped. */
  slack?: 'sent' | 'failed' | 'below'
  /** This run retried the lead's previous run. */
  retry?: boolean
  aiMs?: number
}

export interface SampleOverrideSpec {
  atHours: number
  criteria: SampleCriteria
  priority: LeadPriority
  category: string
  reason: string
  summary: string
  recommendedAction: string
}

export type SampleTimelineSpec =
  | { atHours: number; status: LeadStatus }
  | { atHours: number; note: string }
  | { atHours: number; duplicate: true }

export interface SampleLeadSpec {
  name: string
  email: string
  phone: string | null
  company: string
  jobTitle: string | null
  website: string | null
  source: LeadSource
  message: string
  status: LeadStatus
  /** The lead was created this many days (plus hourOffset hours) before "now". */
  createdDaysAgo: number
  hourOffset: number
  runs: SampleRunSpec[]
  /** Qualification status when the lead never went through a run. */
  qualificationStatusWithoutRun?: Extract<QualificationStatus, 'pending' | 'skipped'>
  qualificationNote?: string
  override?: SampleOverrideSpec
  timeline?: SampleTimelineSpec[]
}

const intake = (atHours: number, ai: SampleAiOutcome, extra: Partial<SampleRunSpec> = {}): SampleRunSpec => ({
  workflowKey: 'lead_intake',
  engine: 'worker',
  trigger: 'web_form',
  atHours,
  ai,
  ...extra,
})

const qualify = (atHours: number, ai: SampleAiOutcome, extra: Partial<SampleRunSpec> = {}): SampleRunSpec => ({
  workflowKey: 'lead_qualification',
  engine: 'worker',
  trigger: 'manual',
  atHours,
  ai,
  ...extra,
})

const n8nIntake = (atHours: number, ai: SampleAiOutcome, extra: Partial<SampleRunSpec> = {}): SampleRunSpec =>
  intake(atHours, ai, { engine: 'n8n', trigger: 'n8n_webhook', ...extra })

export const SAMPLE_LEADS: SampleLeadSpec[] = [
  {
    name: 'Ada Sampleton',
    email: 'ada.sampleton@quillfeather.example',
    phone: '+1 555-0101',
    company: 'Quillfeather Analytics (Sample)',
    jobTitle: 'CTO',
    website: 'https://quillfeather.example',
    source: 'website_form',
    message:
      'We need a multi-tenant SaaS dashboard so our customers can explore their own analytics. React front end, Postgres, SSO for enterprise accounts. Budget is around $60k and we want a first release by the end of Q1.',
    status: 'won',
    createdDaysAgo: 41,
    hourOffset: 3,
    runs: [
      intake(0.001, {
        criteria: [24, 23, 18, 14, 13],
        priority: 'high',
        category: 'software_development',
        confidence: 0.93,
        outcome: 'completed',
        summary: 'CTO requesting a multi-tenant analytics SaaS with SSO; ~$60k budget, Q1 launch.',
        reasoning:
          'Explicit build request that matches custom software development. Budget and deadline are stated, the sender is a CTO on a company domain, and the scope is described in enough detail to scope.',
        recommendedAction: 'Book a discovery call within 24 hours and prepare a phased SaaS proposal.',
      }, { slack: 'sent' }),
    ],
    timeline: [
      { atHours: 3, status: 'contacted' },
      { atHours: 30, note: 'Discovery call done. They want a fixed-price first phase. (sample note)' },
      { atHours: 96, status: 'proposal' },
      { atHours: 340, status: 'won' },
    ],
  },
  {
    name: 'Ben Mockridge',
    email: 'ben.mockridge@tidewater-freight.example',
    phone: '+1 555-0102',
    company: 'Tidewater Freight Co. (Sample)',
    jobTitle: 'Operations Director',
    website: 'https://tidewater-freight.example',
    source: 'landing_page',
    message:
      'Looking to automate our inbound order emails: classify ~400 emails a day with AI and push structured orders into our ERP. Budget $25-35k, we would like a pilot running within 6 weeks.',
    status: 'proposal',
    createdDaysAgo: 12,
    hourOffset: 5,
    runs: [
      intake(0.001, {
        criteria: [23, 24, 17, 13, 12],
        priority: 'high',
        category: 'ai_automation',
        confidence: 0.9,
        outcome: 'completed',
        summary: 'Operations director wants AI email-to-ERP order automation; $25-35k, 6-week pilot.',
        reasoning:
          'Clear automation project in the AI automation service line with a budget range and timeline. Director-level contact on a company domain. Volume figures make the scope concrete.',
        recommendedAction: 'Send the AI automation case study and propose a paid 2-week pilot scope.',
      }, { slack: 'sent', trigger: 'web_form' }),
    ],
    timeline: [
      { atHours: 2, status: 'contacted' },
      { atHours: 70, status: 'proposal' },
    ],
  },
  {
    name: 'Carla Lorem',
    email: 'carla@copperkettle.example',
    phone: '+1 555-0103',
    company: 'Copperkettle Coffee Roasters (Sample)',
    jobTitle: 'Marketing Manager',
    website: 'https://copperkettle.example',
    source: 'website_form',
    message:
      'Our website is six years old and painfully slow on mobile. We want a redesign with online ordering for beans and subscriptions. Budget is roughly $12k, no hard deadline.',
    status: 'contacted',
    createdDaysAgo: 8,
    hourOffset: 7,
    runs: [
      intake(0.001, {
        criteria: [20, 22, 10, 9, 12],
        priority: 'high',
        category: 'web_design',
        confidence: 0.84,
        outcome: 'completed',
        summary: 'Coffee roaster wants a mobile-friendly redesign with online ordering; ~$12k.',
        reasoning:
          'Direct redesign request that fits web design services. Budget stated but no timeline. Marketing manager may need sign-off from the owner.',
        recommendedAction: 'Reply with two redesign references and ask who approves the budget.',
      }, { slack: 'sent' }),
    ],
    timeline: [{ atHours: 20, status: 'contacted' }],
  },
  {
    name: 'Dev Placeholder',
    email: 'dev@lumenlark.example',
    phone: '+1 555-0104',
    company: 'Lumen & Lark Bakery (Sample)',
    jobTitle: 'Founder',
    website: null,
    source: 'referral',
    message:
      'A friend recommended you. We are thinking about a simple loyalty app for iOS and Android (stamp card, push offers). Have not worked out a budget yet.',
    status: 'lost',
    createdDaysAgo: 20,
    hourOffset: 2,
    runs: [
      qualify(0.5, {
        criteria: [18, 20, 5, 10, 9],
        priority: 'medium',
        category: 'mobile_app',
        confidence: 0.78,
        outcome: 'completed',
        summary: 'Bakery founder exploring a loyalty mobile app; no budget yet.',
        reasoning:
          'Real interest in a mobile app that matches services, decision maker is the founder, but there is no budget or timeline and the feature set is still vague.',
        recommendedAction: 'Offer a short scoping call and share typical cost ranges for loyalty apps.',
      }, { slack: 'below' }),
    ],
    timeline: [
      { atHours: 4, status: 'contacted' },
      { atHours: 150, note: 'Decided to postpone the app until next year. (sample note)' },
      { atHours: 151, status: 'lost' },
    ],
  },
  {
    name: 'Elena Ipsum',
    email: 'elena.ipsum@harborlight.example',
    phone: '+1 555-0105',
    company: 'Harborlight Dental Group (Sample)',
    jobTitle: 'Head of Data',
    website: 'https://harborlight.example',
    source: 'linkedin',
    message:
      'We run 14 clinics and need a reporting pipeline that consolidates appointment and billing data into dashboards for the leadership team. Budget is approved for this fiscal year; we are aiming for three months.',
    status: 'qualified',
    createdDaysAgo: 5,
    hourOffset: 4,
    runs: [
      qualify(1, {
        criteria: [22, 21, 16, 14, 13],
        priority: 'high',
        category: 'data_analytics',
        confidence: 0.88,
        outcome: 'completed',
        summary: 'Dental group (14 clinics) needs a consolidated reporting pipeline; budget approved, 3 months.',
        reasoning:
          'Data analytics project with approved budget and a timeline. Head of Data has authority and the request is specific about sources and audience.',
        recommendedAction: 'Schedule a technical discovery session with their data team this week.',
      }, { slack: 'sent' }),
    ],
    timeline: [
      { atHours: 3, status: 'contacted' },
      { atHours: 28, status: 'qualified' },
    ],
  },
  {
    name: 'Farah Dolor',
    email: 'farah.dolor@example.net',
    phone: null,
    company: 'Independent (Sample)',
    jobTitle: 'Frontend Developer',
    website: 'https://portfolio.farah-dolor.example',
    source: 'website_form',
    message:
      "Hi! I'm a frontend developer with four years of React experience. I'd love to be considered for any openings on your team. My portfolio is linked above.",
    status: 'disqualified',
    createdDaysAgo: 30,
    hourOffset: 9,
    runs: [
      intake(0.001, {
        criteria: [3, 2, 0, 3, 10],
        priority: 'low',
        category: 'job_application',
        confidence: 0.95,
        outcome: 'completed',
        summary: 'Job application from a frontend developer, not a sales inquiry.',
        reasoning: 'The message is a job application rather than a request for services, so buying intent and fit are minimal.',
        recommendedAction: 'Forward to hiring and mark as not a sales lead.',
      }, { slack: 'below' }),
    ],
    timeline: [{ atHours: 6, status: 'disqualified' }],
  },
  {
    name: 'Gus Dummyfield',
    email: 'offers@toprank-growth.example',
    phone: null,
    company: 'TopRank Growth Agency (Sample)',
    jobTitle: null,
    website: 'https://toprank-growth.example',
    source: 'website_form',
    message:
      'Dear website owner, we GUARANTEE first-page search rankings in 30 days for only $99/month. Limited offer, reply YES to get started!!!',
    status: 'new',
    createdDaysAgo: 3,
    hourOffset: 11,
    runs: [
      intake(0.001, {
        criteria: [0, 0, 1, 2, 3],
        priority: 'low',
        category: 'spam',
        confidence: 0.97,
        outcome: 'needs_review',
        summary: 'Unsolicited SEO sales pitch.',
        reasoning: 'Mass-marketing SEO offer with no request for services. Classified as spam, which always routes to review.',
        recommendedAction: 'Confirm as spam and disqualify.',
      }, { slack: 'below', aiMs: 900 }),
    ],
  },
  {
    name: 'Hal Fixture',
    email: 'hal@blockyield.example',
    phone: null,
    company: 'BlockYield Partners (Sample)',
    jobTitle: 'Partnerships',
    website: null,
    source: 'email',
    message:
      'Partnership opportunity: integrate our token rewards into your clients’ apps for a 40% revenue share. Need your answer today to lock in founding-partner terms.',
    status: 'new',
    createdDaysAgo: 15,
    hourOffset: 6,
    runs: [
      qualify(2, {
        criteria: [2, 3, 2, 3, 3],
        priority: 'low',
        category: 'spam',
        confidence: 0.72,
        outcome: 'needs_review',
        summary: 'High-pressure token rewards partnership pitch.',
        reasoning: 'Unsolicited offer with urgency pressure and no service request. Looks like spam but mentions a partnership, so a human should confirm.',
        recommendedAction: 'Review and disqualify unless the sender is known.',
      }, { slack: 'below' }),
    ],
  },
  {
    name: 'Ivy Stubworth',
    email: 'office@pinecrest-vet.example',
    phone: '+1 555-0109',
    company: 'Pinecrest Veterinary Clinic (Sample)',
    jobTitle: 'Office Manager',
    website: 'https://pinecrest-vet.example',
    source: 'n8n',
    message:
      'The appointment booking form you built for us last year stopped sending confirmation emails on Monday. Clients are calling to double-check bookings. Can someone take a look?',
    status: 'contacted',
    createdDaysAgo: 2,
    hourOffset: 8,
    runs: [
      n8nIntake(0.001, {
        criteria: [8, 14, 2, 8, 12],
        priority: 'medium',
        category: 'support_request',
        confidence: 0.81,
        outcome: 'completed',
        summary: 'Existing client reports booking confirmation emails failing since Monday.',
        reasoning: 'Support issue from an existing client rather than new work. Clear description and contact details; small potential for a maintenance retainer.',
        recommendedAction: 'Open a support ticket and reply with an ETA today.',
      }, { slack: 'below' }),
    ],
    timeline: [{ atHours: 1.5, status: 'contacted' }],
  },
  {
    name: 'Jonah Fakewell',
    email: 'jonah.fakewell@cobaltwave.example',
    phone: '+1 555-0110',
    company: 'Cobaltwave Robotics (Sample)',
    jobTitle: 'VP Engineering',
    website: 'https://cobaltwave.example',
    source: 'event',
    message:
      'Following up from the meetup: we need help building an internal tool to track robot fleet telemetry. Could you add two senior engineers to our team for four months? Roughly $20k per month.',
    status: 'proposal',
    createdDaysAgo: 27,
    hourOffset: 1,
    runs: [
      qualify(1, {
        criteria: [23, 22, 18, 15, 13],
        priority: 'high',
        category: 'software_development',
        confidence: 0.91,
        outcome: 'completed',
        summary: 'VP Engineering wants 2 senior engineers for 4 months on a telemetry tool; ~$20k/month.',
        reasoning: 'Concrete staffing request for software development with budget and duration. VP-level authority and an in-person introduction.',
        recommendedAction: 'Propose a team and start date; send rate card today.',
      }, { slack: 'failed' }),
    ],
    timeline: [
      { atHours: 2, note: 'Slack alert failed (webhook revoked); team notified manually. (sample note)' },
      { atHours: 5, status: 'contacted' },
      { atHours: 120, status: 'proposal' },
    ],
  },
  {
    name: 'Kira Testova',
    email: 'kira.testova@saltmarsh-realty.example',
    phone: '+1 555-0111',
    company: 'Saltmarsh Realty (Sample)',
    jobTitle: 'Product Owner',
    website: 'https://saltmarsh-realty.example',
    source: 'website_form',
    message:
      'We want to add AI-written property descriptions to our listing admin, and maybe a chat assistant for buyers later. Still exploring options; the timeline is flexible.',
    status: 'qualified',
    createdDaysAgo: 10,
    hourOffset: 10,
    runs: [
      intake(0.001, {
        criteria: [17, 20, 6, 11, 10],
        priority: 'medium',
        category: 'ai_automation',
        confidence: 0.74,
        outcome: 'completed',
        summary: 'Realty firm exploring AI-generated listing descriptions; flexible timeline.',
        reasoning: 'Good fit for AI automation, but the request is exploratory with no budget and a flexible timeline.',
        recommendedAction: 'Send a short AI content generation demo and ask about budget range.',
      }, { slack: 'below' }),
    ],
    timeline: [
      { atHours: 22, status: 'contacted' },
      { atHours: 75, status: 'qualified' },
    ],
  },
  {
    name: 'Leo Demoray',
    email: 'leo.demoray@example.org',
    phone: null,
    company: 'Lakeshore University (Sample)',
    jobTitle: 'Student',
    website: null,
    source: 'website_form',
    message:
      'Hello, I am writing a university project on CRM automation. Could I interview someone from your team for about 20 minutes?',
    status: 'disqualified',
    createdDaysAgo: 23,
    hourOffset: 5,
    runs: [
      intake(0.001, {
        criteria: [2, 4, 0, 2, 9],
        priority: 'low',
        category: 'other',
        confidence: 0.86,
        outcome: 'completed',
        summary: 'Student requesting an interview for a university project.',
        reasoning: 'No purchase intent; an informational request from a student.',
        recommendedAction: 'Reply politely if time allows; not a sales opportunity.',
      }, { slack: 'below' }),
    ],
    timeline: [{ atHours: 26, status: 'disqualified' }],
  },
  {
    name: 'Mina Sampleworth',
    email: 'mina@ironbark-fitness.example',
    phone: '+1 555-0113',
    company: 'Ironbark Fitness Studios (Sample)',
    jobTitle: 'CEO',
    website: 'https://ironbark-fitness.example',
    source: 'phone',
    message:
      'Phone inquiry: wants a member portal with class booking and payments for three studio locations. Budget about $40k, would like to start next month.',
    status: 'won',
    createdDaysAgo: 38,
    hourOffset: 6,
    runs: [
      qualify(0.3, {
        criteria: [24, 23, 18, 15, 11],
        priority: 'high',
        category: 'software_development',
        confidence: 0.9,
        outcome: 'completed',
        summary: 'Fitness chain CEO wants a member portal with booking and payments; ~$40k, start next month.',
        reasoning: 'Decision maker with a defined build, budget and start date. Phone notes are brief, so some details still need confirming.',
        recommendedAction: 'Send a proposal with a 3-phase plan this week.',
      }, { slack: 'sent' }),
    ],
    timeline: [
      { atHours: 1, status: 'contacted' },
      { atHours: 60, status: 'proposal' },
      { atHours: 260, status: 'won' },
    ],
  },
  {
    name: 'Nico Mockwell',
    email: 'nico.mockwell@fernhollow.example',
    phone: '+1 555-0114',
    company: 'Fernhollow Community College (Sample)',
    jobTitle: 'IT Coordinator',
    website: 'https://fernhollow.example',
    source: 'website_form',
    message:
      'Requesting a quote to migrate our course catalog website to a modern CMS. Procurement requires three quotes by the end of the month.',
    status: 'lost',
    createdDaysAgo: 35,
    hourOffset: 2,
    runs: [
      intake(0.001, {
        criteria: [19, 20, 14, 12, 12],
        priority: 'high',
        category: 'web_design',
        confidence: 0.82,
        outcome: 'completed',
        summary: 'College requests a quote for a CMS migration of its course catalog; quotes due end of month.',
        reasoning: 'Formal quote request that fits web services, with a procurement deadline. Competitive bid lowers the odds somewhat.',
        recommendedAction: 'Submit a quote before the procurement deadline.',
      }, { slack: 'sent' }),
    ],
    timeline: [
      { atHours: 4, status: 'contacted' },
      { atHours: 50, status: 'proposal' },
      { atHours: 400, note: 'Procurement chose a lower bid. (sample note)' },
      { atHours: 401, status: 'lost' },
    ],
  },
  {
    name: 'Opal Fixturewood',
    email: 'opal@brightloom.example',
    phone: '+1 555-0115',
    company: 'Brightloom Design Agency (Sample)',
    jobTitle: 'Partnerships Lead',
    website: 'https://brightloom.example',
    source: 'email',
    message:
      'We are a design agency looking for a development partner for overflow work, typically two or three projects per quarter. Interested in a call?',
    status: 'contacted',
    createdDaysAgo: 18,
    hourOffset: 3,
    runs: [
      qualify(3, {
        criteria: [15, 18, 8, 12, 11],
        priority: 'medium',
        category: 'partnership',
        confidence: 0.69,
        outcome: 'completed',
        summary: 'Design agency seeking a recurring development partner for overflow projects.',
        reasoning: 'Recurring partnership could be valuable, but no specific project, budget or timeline yet.',
        recommendedAction: 'Book an intro call and share the partner rate card.',
      }, { slack: 'below' }),
    ],
    timeline: [{ atHours: 26, status: 'contacted' }],
  },
  {
    name: 'Pax Dummond',
    email: 'pax@dummond-consulting.example',
    phone: '+1 555-0116',
    company: 'Dummond Consulting (Sample)',
    jobTitle: 'Owner',
    website: 'https://dummond-consulting.example',
    source: 'n8n',
    message:
      'Could you advise us on whether to build or buy a CRM for our 12-person firm? A two-hour workshop would be ideal.',
    status: 'new',
    createdDaysAgo: 6,
    hourOffset: 2,
    runs: [
      n8nIntake(0.001, {
        criteria: [16, 17, 9, 9, 10],
        priority: 'medium',
        category: 'consulting',
        confidence: 0.65,
        outcome: 'completed',
        summary: 'Small firm owner wants a two-hour build-vs-buy CRM workshop.',
        reasoning: 'Clear request for a consulting workshop from the owner; small scope and no stated budget.',
        recommendedAction: 'Offer the fixed-price workshop package.',
      }, { slack: 'below' }),
    ],
  },
  {
    name: 'Quinn Stubbington',
    email: 'quinn@mapleway-tutors.example',
    phone: '+1 555-0117',
    company: 'Mapleway Tutors (Sample)',
    jobTitle: 'Co-founder',
    website: 'https://mapleway-tutors.example',
    source: 'landing_page',
    message:
      'We need an MVP that matches tutors with students, mobile first. Investor meeting in 8 weeks, budget about $30k.',
    status: 'qualified',
    createdDaysAgo: 14,
    hourOffset: 7,
    runs: [
      intake(0.001, 'unavailable'),
      qualify(0.6, {
        criteria: [22, 22, 17, 13, 12],
        priority: 'high',
        category: 'mobile_app',
        confidence: 0.87,
        outcome: 'completed',
        summary: 'Startup co-founder needs a tutor-matching mobile MVP in 8 weeks; ~$30k.',
        reasoning: 'Well-defined MVP with budget and investor deadline. Co-founder has authority. Mobile-first fits the mobile app service.',
        recommendedAction: 'Propose an 8-week MVP plan with a weekly demo cadence.',
      }, { trigger: 'retry', retry: true, slack: 'sent' }),
    ],
    timeline: [
      { atHours: 5, status: 'contacted' },
      { atHours: 48, status: 'qualified' },
    ],
  },
  {
    name: 'Rosa Examplar',
    email: 'rosa@glimmerfield-events.example',
    phone: null,
    company: 'Glimmerfield Events (Sample)',
    jobTitle: null,
    website: null,
    source: 'website_form',
    message: 'Hi, saw your site. What do you do exactly? Interested in maybe automating some stuff.',
    status: 'new',
    createdDaysAgo: 4,
    hourOffset: 9,
    runs: [
      intake(0.001, {
        criteria: [8, 10, 1, 4, 4],
        priority: 'low',
        category: 'ai_automation',
        confidence: 0.48,
        outcome: 'needs_review',
        summary: 'Vague interest in automation from an events company.',
        reasoning: 'Possible automation interest but almost no detail, no role and no budget. Low confidence in the category.',
        recommendedAction: 'Reply asking which processes they want to automate.',
      }, { slack: 'below' }),
    ],
  },
  {
    name: 'Sami Testwood',
    email: 'sami@driftwood-kayak.example',
    phone: '+1 555-0119',
    company: 'Driftwood Kayak Rentals (Sample)',
    jobTitle: 'Owner',
    website: null,
    source: 'website_form',
    message:
      'Need a booking website before the summer season. Budget is small, maybe $3k. Can you do something like that?',
    status: 'new',
    createdDaysAgo: 9,
    hourOffset: 1,
    runs: [
      intake(0.001, {
        criteria: [18, 19, 8, 9, 10],
        priority: 'medium',
        category: 'web_design',
        confidence: 0.58,
        outcome: 'needs_review',
        summary: 'Kayak rental owner wants a booking website before summer; ~$3k budget.',
        reasoning: 'Fits web design but the budget may be below the minimum engagement. Could also be a template-site job, so confidence is limited.',
        recommendedAction: 'Check minimum engagement size before replying.',
      }, { slack: 'below' }),
    ],
  },
  {
    name: 'Theo Ipsumson',
    email: 'theo@starfold-payments.example',
    phone: '+1 555-0120',
    company: 'Starfold Payments (Sample)',
    jobTitle: 'CTO',
    website: 'https://starfold-payments.example',
    source: 'api',
    message:
      'We need help hardening our checkout API and adding webhook retries. Some of the work touches PCI-scoped systems.',
    status: 'new',
    createdDaysAgo: 1,
    hourOffset: 3,
    runs: [intake(0.001, 'unavailable', { trigger: 'api' }), qualify(2, 'unavailable', { trigger: 'retry', retry: true })],
    qualificationNote: 'AI provider unavailable after 2 attempts (HTTP 503). Retry from the lead page.',
  },
  {
    name: 'Uma Samplevale',
    email: 'uma.samplevale@wrenfield.example',
    phone: '+1 555-0121',
    company: 'Wrenfield Library Trust (Sample)',
    jobTitle: 'Director',
    website: 'https://wrenfield.example',
    source: 'website_form',
    message:
      'We need an accessibility audit of our public website and fixes for the issues found, ideally before our grant review in the spring.',
    status: 'contacted',
    createdDaysAgo: 22,
    hourOffset: 4,
    runs: [intake(0.001, 'invalid_response'), qualify(20, 'invalid_response', { trigger: 'retry', retry: true })],
    qualificationNote: 'AI response failed schema validation (criteria missing). Qualify manually or retry.',
    timeline: [{ atHours: 30, status: 'contacted' }],
  },
  {
    name: 'Vic Stubhaus',
    email: 'vic@orchardlane-grocers.example',
    phone: '+1 555-0122',
    company: 'Orchard Lane Grocers (Sample)',
    jobTitle: 'Operations Manager',
    website: 'https://orchardlane-grocers.example',
    source: 'n8n',
    message:
      'We want low-stock alerts from our inventory system posted to our team chat, plus a weekly reorder summary.',
    status: 'new',
    createdDaysAgo: 11,
    hourOffset: 8,
    runs: [n8nIntake(0.001, 'unavailable')],
    qualificationNote: 'AI request timed out in the n8n workflow. Retry from the lead page.',
  },
  {
    name: 'Wes Demoberg',
    email: 'wes.demoberg@pebblecrest.example',
    phone: '+1 555-0123',
    company: 'Pebblecrest Insurance (Sample)',
    jobTitle: 'Head of Growth',
    website: 'https://pebblecrest.example',
    source: 'website_form',
    message:
      'We would like a lead scoring model built on our CRM history and wired into our sales team’s daily workflow.',
    status: 'new',
    createdDaysAgo: 0,
    hourOffset: 5,
    runs: [intake(0.001, 'quota')],
  },
  {
    name: 'Xena Mockford',
    email: 'xena@sundial-skincare.example',
    phone: '+1 555-0124',
    company: 'Sundial Skincare (Sample)',
    jobTitle: 'Founder',
    website: 'https://sundial-skincare.example',
    source: 'manual',
    message: 'Entered after a call: wants a storefront redesign and a subscription box flow. Will send brand guidelines.',
    status: 'new',
    createdDaysAgo: 0,
    hourOffset: 2,
    runs: [],
    qualificationStatusWithoutRun: 'pending',
  },
  {
    name: 'Yara Fixture',
    email: 'yara.fixture@kestrel-storage.example',
    phone: null,
    company: 'Kestrel Self Storage (Sample)',
    jobTitle: 'Facilities Coordinator',
    website: null,
    source: 'website_form',
    message: 'Please remove us from your mailing list. Thank you.',
    status: 'disqualified',
    createdDaysAgo: 33,
    hourOffset: 6,
    runs: [intake(0.001, 'disabled')],
    timeline: [{ atHours: 3, status: 'disqualified' }],
  },
  {
    name: 'Zane Exampleton',
    email: 'zane@hearthstone-plumbing.example',
    phone: '+1 555-0126',
    company: 'Hearthstone Plumbing (Sample)',
    jobTitle: 'Owner',
    website: 'https://hearthstone-plumbing.example',
    source: 'manual',
    message: 'Imported from the previous CRM: existing website maintenance client since last year.',
    status: 'won',
    createdDaysAgo: 44,
    hourOffset: 5,
    runs: [],
    qualificationStatusWithoutRun: 'skipped',
    timeline: [{ atHours: 0.2, status: 'won' }],
  },
  {
    name: 'Bea Quillon',
    email: 'bea.quillon@oakhaven-legal.example',
    phone: '+1 555-0127',
    company: 'Oakhaven Legal LLP (Sample)',
    jobTitle: 'Managing Partner',
    website: 'https://oakhaven-legal.example',
    source: 'referral',
    message:
      'Referred by Pinecrest Veterinary. We need a secure client intake portal with document upload and e-signature.',
    status: 'proposal',
    createdDaysAgo: 16,
    hourOffset: 3,
    runs: [
      qualify(0.4, {
        criteria: [18, 20, 9, 12, 10],
        priority: 'medium',
        category: 'software_development',
        confidence: 0.76,
        outcome: 'completed',
        summary: 'Law firm partner wants a secure client intake portal with uploads and e-signature.',
        reasoning: 'Strong fit and senior contact, but no budget or timeline in the message.',
        recommendedAction: 'Book a discovery call to confirm budget and compliance needs.',
      }, { slack: 'below' }),
    ],
    override: {
      atHours: 26,
      criteria: [22, 23, 17, 12, 8],
      priority: 'high',
      category: 'software_development',
      reason: 'Budget (~$45k) and a March deadline were confirmed on the discovery call; referral from an existing client.',
      summary: 'Law firm client portal; budget and deadline confirmed on call.',
      recommendedAction: 'Send the proposal by Friday.',
    },
    timeline: [
      { atHours: 24, status: 'contacted' },
      { atHours: 100, status: 'proposal' },
    ],
  },
  {
    name: 'Cal Dummington',
    email: 'cal@hollowbrook-games.example',
    phone: '+1 555-0128',
    company: 'Hollowbrook Games (Sample)',
    jobTitle: 'Product Manager',
    website: 'https://hollowbrook-games.example',
    source: 'website_form',
    message:
      'We need a companion web app for our indie game with leaderboards and player profiles. Budget around $15k, launch alongside our next update in two months.',
    status: 'contacted',
    createdDaysAgo: 25,
    hourOffset: 6,
    runs: [
      intake(0.001, {
        criteria: [20, 21, 12, 11, 12],
        priority: 'high',
        category: 'software_development',
        confidence: 0.83,
        outcome: 'completed',
        summary: 'Game studio wants a companion web app with leaderboards; ~$15k, 2-month timeline.',
        reasoning: 'Specific build request with budget and launch date. Product manager may need studio approval.',
        recommendedAction: 'Reply with a similar case study and propose a call.',
      }, { slack: 'sent' }),
    ],
    timeline: [
      { atHours: 8, status: 'contacted' },
      { atHours: 120, duplicate: true },
    ],
  },
]

// ---------------------------------------------------------------------------
// Materialized rows (snake_case, ready to insert)
// ---------------------------------------------------------------------------

export interface SampleLeadRow {
  id: string
  workspace_id: string
  name: string
  email: string
  phone: string | null
  company: string
  job_title: string | null
  website: string | null
  source: LeadSource
  message: string
  status: LeadStatus
  score: number | null
  priority: LeadPriority | null
  category: string | null
  ai_summary: string | null
  ai_reasoning: string | null
  recommended_action: string | null
  confidence: number | null
  qualification_status: QualificationStatus
  qualification_error: string | null
  last_qualified_at: string | null
  owner_id: null
  is_sample: true
  submission_count: number
  created_by: null
  created_at: string
  updated_at: string
}

export interface SampleExecutionRow {
  id: string
  workspace_id: string
  lead_id: string
  workflow_key: WorkflowKey
  engine: WorkflowEngine
  trigger: WorkflowTrigger
  status: Exclude<ExecutionStatus, 'running'>
  steps: ExecutionStep[]
  attempt: number
  retry_of_id: string | null
  error_code: string | null
  error_message: string | null
  started_at: string
  finished_at: string
  duration_ms: number
  created_by: null
  is_sample: true
}

export interface SampleQualificationRow {
  id: string
  workspace_id: string
  lead_id: string
  source: QualificationSource
  score: number
  priority: LeadPriority
  category: string
  summary: string
  reasoning: string | null
  recommended_action: string
  confidence: number | null
  criteria: CriterionResult[]
  adjustments: string[]
  model: string | null
  prompt_version: null
  override_reason: string | null
  execution_id: string | null
  created_by: null
  is_sample: true
  created_at: string
}

export interface SampleActivityRow {
  id: string
  workspace_id: string
  lead_id: string
  type: ActivityType
  body: string | null
  metadata: Record<string, unknown>
  actor_id: null
  is_sample: true
  created_at: string
}

export interface SampleNotificationRow {
  id: string
  workspace_id: string
  lead_id: string
  execution_id: string
  channel: 'slack'
  status: Extract<NotificationStatus, 'sent' | 'failed'>
  error: string | null
  payload: Record<string, unknown>
  is_sample: true
  created_at: string
}

export interface SampleDataset {
  leads: SampleLeadRow[]
  executions: SampleExecutionRow[]
  qualifications: SampleQualificationRow[]
  activities: SampleActivityRow[]
  notifications: SampleNotificationRow[]
}

export interface MaterializeOptions {
  workspaceId: string
  /** Defaults to crypto.randomUUID(). */
  newId?: () => string
  /** Restrict to these specs (e.g. to skip emails that already exist). Defaults to SAMPLE_LEADS. */
  leads?: SampleLeadSpec[]
}

const HOUR_MS = 3_600_000
const SLACK_ERROR = 'Slack webhook returned HTTP 404: no_service'

export const sampleCriteriaTotal = (criteria: SampleCriteria): number => criteria.reduce((a, b) => a + b, 0)

const toCriteria = (criteria: SampleCriteria): CriterionResult[] =>
  SAMPLE_CRITERIA_KEYS.map((key, i) => ({ key, score: criteria[i] }))

/** Small deterministic variation so step durations look organic but the dataset stays reproducible. */
function vary(seed: string, base: number, spread: number): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return base + (Math.abs(h) % (spread + 1))
}

interface BuiltRun {
  status: Exclude<ExecutionStatus, 'running'>
  steps: Omit<ExecutionStep, 'startedAt'>[]
  errorCode: string | null
  errorMessage: string | null
  qualificationError: string | null
}

function buildRun(run: SampleRunSpec, seed: string): BuiltRun {
  const steps: Omit<ExecutionStep, 'startedAt'>[] = []
  const add = (key: ExecutionStepKey, status: StepStatus, durationMs: number, message?: string, attempts?: number) => {
    const step: Omit<ExecutionStep, 'startedAt'> = { key, status, durationMs }
    if (attempts !== undefined) step.attempts = attempts
    if (message !== undefined) step.message = message
    steps.push(step)
  }
  const isIntake = run.workflowKey === 'lead_intake'
  if (isIntake) {
    add('validate', 'succeeded', vary(`${seed}v`, 3, 9))
    add('deduplicate', 'succeeded', vary(`${seed}d`, 18, 40))
  }

  let status: BuiltRun['status'] = 'succeeded'
  let errorCode: string | null = null
  let errorMessage: string | null = null
  let qualificationError: string | null = null
  const aiMs = run.aiMs ?? vary(`${seed}a`, 1200, 1600)

  if (typeof run.ai === 'object') {
    add('ai_classify', 'succeeded', aiMs, undefined, 1)
    add('persist', 'succeeded', vary(`${seed}p`, 35, 60))
  } else if (run.ai === 'unavailable' || run.ai === 'invalid_response') {
    const unavailable = run.ai === 'unavailable'
    errorCode = unavailable ? 'ai_unavailable' : 'ai_invalid_response'
    errorMessage = unavailable
      ? run.engine === 'n8n'
        ? 'AI request timed out after 20s'
        : 'AI provider returned HTTP 503 after 2 attempts'
      : 'AI response failed schema validation: "criteria" is required'
    qualificationError = errorMessage
    add('ai_classify', 'failed', unavailable ? aiMs * 2 : aiMs, errorMessage, unavailable ? 2 : 1)
    // Intake still stores the lead, so the run is partial; a qualification-only run has nothing left to do.
    if (isIntake) add('persist', 'succeeded', vary(`${seed}p`, 35, 60))
    add('notify_slack', 'skipped', 0, 'No qualification result')
    status = isIntake ? 'partial' : 'failed'
  } else {
    add('ai_classify', 'skipped', 0, run.ai === 'quota' ? 'Workspace daily AI limit reached; lead left pending' : 'AI qualification disabled for this workspace')
    add('persist', 'succeeded', vary(`${seed}p`, 35, 60))
    add('notify_slack', 'skipped', 0, 'No qualification result')
  }

  if (typeof run.ai === 'object') {
    if (run.slack === 'sent') add('notify_slack', 'succeeded', vary(`${seed}s`, 220, 380), undefined, 1)
    else if (run.slack === 'failed') {
      add('notify_slack', 'failed', vary(`${seed}s`, 180, 120), SLACK_ERROR, 1)
      status = 'partial'
      errorCode = 'integration_failed'
      errorMessage = `Slack notification failed: ${SLACK_ERROR}`
    } else add('notify_slack', 'skipped', 0, 'Priority below the Slack alert threshold (high)')
  }
  return { status, steps, errorCode, errorMessage, qualificationError }
}

/**
 * Turns SAMPLE_LEADS into insertable rows with absolute timestamps relative to `now`. Every row is
 * is_sample = true. No timestamp is later than `now`.
 */
export function materializeSampleData(now: Date, options: MaterializeOptions): SampleDataset {
  const newId = options.newId ?? (() => crypto.randomUUID())
  const ws = options.workspaceId
  const nowMs = now.getTime()
  const at = (ms: number) => new Date(Math.min(ms, nowMs - 1000)).toISOString()
  const out: SampleDataset = { leads: [], executions: [], qualifications: [], activities: [], notifications: [] }

  for (const spec of options.leads ?? SAMPLE_LEADS) {
    const leadId = newId()
    const createdMs = nowMs - (spec.createdDaysAgo * 24 + spec.hourOffset) * HOUR_MS
    const atHours = (h: number) => createdMs + h * HOUR_MS
    let lastMs = createdMs
    const activity = (ms: number, type: ActivityType, body: string | null, metadata: Record<string, unknown> = {}) => {
      lastMs = Math.max(lastMs, ms)
      out.activities.push({
        id: newId(),
        workspace_id: ws,
        lead_id: leadId,
        type,
        body,
        metadata,
        actor_id: null,
        is_sample: true,
        created_at: at(ms),
      })
    }

    activity(createdMs, 'lead_created', null, { source: spec.source })

    let current: { qualification: SampleQualificationRow; spec: SampleQualificationSpec | SampleOverrideSpec } | null = null
    let qualificationStatus: QualificationStatus = spec.qualificationStatusWithoutRun ?? 'pending'
    let qualificationError: string | null = null
    let previousRun: SampleExecutionRow | null = null

    for (const [i, run] of spec.runs.entries()) {
      const built = buildRun(run, `${spec.email}#${i}`)
      const startMs = atHours(run.atHours)
      let offset = 0
      const steps: ExecutionStep[] = built.steps.map((s) => {
        const step = { ...s, startedAt: at(startMs + offset) }
        offset += s.durationMs
        return step
      })
      const durationMs = offset + vary(`${spec.email}#${i}o`, 6, 20)
      const execution: SampleExecutionRow = {
        id: newId(),
        workspace_id: ws,
        lead_id: leadId,
        workflow_key: run.workflowKey,
        engine: run.engine,
        trigger: run.trigger,
        status: built.status,
        steps,
        attempt: run.retry && previousRun ? previousRun.attempt + 1 : 1,
        retry_of_id: run.retry && previousRun ? previousRun.id : null,
        error_code: built.errorCode,
        error_message: built.errorMessage,
        started_at: at(startMs),
        finished_at: at(startMs + durationMs),
        duration_ms: durationMs,
        created_by: null,
        is_sample: true,
      }
      out.executions.push(execution)
      previousRun = execution
      const doneMs = startMs + durationMs
      lastMs = Math.max(lastMs, doneMs)

      if (typeof run.ai === 'object') {
        const q = run.ai
        const score = sampleCriteriaTotal(q.criteria)
        const qualification: SampleQualificationRow = {
          id: newId(),
          workspace_id: ws,
          lead_id: leadId,
          source: 'ai',
          score,
          priority: q.priority,
          category: q.category,
          summary: q.summary,
          reasoning: q.reasoning,
          recommended_action: q.recommendedAction,
          confidence: q.confidence,
          criteria: toCriteria(q.criteria),
          adjustments: [],
          model: SAMPLE_DATA_MODEL,
          prompt_version: null,
          override_reason: null,
          execution_id: execution.id,
          created_by: null,
          is_sample: true,
          created_at: at(doneMs),
        }
        out.qualifications.push(qualification)
        current = { qualification, spec: q }
        qualificationStatus = q.outcome
        qualificationError = null
        activity(doneMs, 'qualification_completed', null, {
          score,
          priority: q.priority,
          category: q.category,
          executionId: execution.id,
        })
        if (run.slack === 'sent' || run.slack === 'failed') {
          const sent = run.slack === 'sent'
          out.notifications.push({
            id: newId(),
            workspace_id: ws,
            lead_id: leadId,
            execution_id: execution.id,
            channel: 'slack',
            status: sent ? 'sent' : 'failed',
            error: sent ? null : SLACK_ERROR,
            payload: { leadName: spec.name, company: spec.company, score, priority: q.priority },
            is_sample: true,
            created_at: at(doneMs),
          })
          activity(doneMs, sent ? 'notification_sent' : 'notification_failed', null, sent
            ? { channel: 'slack' }
            : { channel: 'slack', error: SLACK_ERROR })
        }
      } else if (run.ai === 'unavailable' || run.ai === 'invalid_response') {
        qualificationStatus = 'failed'
        qualificationError = spec.qualificationNote ?? built.qualificationError
        activity(doneMs, 'qualification_failed', null, { errorCode: built.errorCode, executionId: execution.id })
      } else {
        qualificationStatus = run.ai === 'quota' ? 'pending' : 'skipped'
      }
    }

    if (spec.override && current) {
      const o = spec.override
      const ms = atHours(o.atHours)
      const score = sampleCriteriaTotal(o.criteria)
      const qualification: SampleQualificationRow = {
        id: newId(),
        workspace_id: ws,
        lead_id: leadId,
        source: 'manual',
        score,
        priority: o.priority,
        category: o.category,
        summary: o.summary,
        reasoning: null,
        recommended_action: o.recommendedAction,
        confidence: null,
        criteria: toCriteria(o.criteria),
        adjustments: [],
        model: null,
        prompt_version: null,
        override_reason: o.reason,
        execution_id: null,
        created_by: null,
        is_sample: true,
        created_at: at(ms),
      }
      activity(ms, 'qualification_override', o.reason, {
        from: { score: current.qualification.score, priority: current.qualification.priority },
        to: { score, priority: o.priority },
      })
      out.qualifications.push(qualification)
      current = { qualification, spec: o }
      qualificationStatus = 'completed'
    }

    let status: LeadStatus = 'new'
    let submissions = 1
    for (const event of spec.timeline ?? []) {
      const ms = atHours(event.atHours)
      if ('status' in event) {
        activity(ms, 'status_changed', null, { from: status, to: event.status })
        status = event.status
      } else if ('note' in event) {
        activity(ms, 'note_added', event.note)
      } else {
        submissions += 1
        activity(ms, 'duplicate_submission', null, { submissionCount: submissions })
      }
    }

    const q = current?.qualification ?? null
    out.leads.push({
      id: leadId,
      workspace_id: ws,
      name: spec.name,
      email: spec.email,
      phone: spec.phone,
      company: spec.company,
      job_title: spec.jobTitle,
      website: spec.website,
      source: spec.source,
      message: spec.message,
      status: spec.status,
      score: q?.score ?? null,
      priority: q?.priority ?? null,
      category: q?.category ?? null,
      ai_summary: q?.summary ?? null,
      ai_reasoning: q?.reasoning ?? null,
      recommended_action: q?.recommended_action ?? null,
      confidence: q?.confidence ?? null,
      qualification_status: qualificationStatus,
      qualification_error: qualificationError,
      last_qualified_at: q?.created_at ?? null,
      owner_id: null,
      is_sample: true,
      submission_count: submissions,
      created_by: null,
      created_at: at(createdMs),
      updated_at: at(lastMs),
    })
  }
  return out
}
