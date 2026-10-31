import type { LeadPriority, QualificationStatus } from './constants'

export interface PriorityThresholds {
  /** Minimum score (inclusive) for `high`. */
  high: number
  /** Minimum score (inclusive) for `medium`. */
  medium: number
}

export const DEFAULT_PRIORITY_THRESHOLDS: PriorityThresholds = { high: 70, medium: 40 }

/** Below this model confidence a completed qualification is flagged for human review. */
export const DEFAULT_REVIEW_CONFIDENCE = 0.6

/** Maximum allowed gap between the model's stated score and the sum of its criterion scores. */
export const SCORE_SUM_TOLERANCE = 5

export interface ScoringCriterion {
  key: string
  label: string
  /** Maximum points for this criterion. All criteria together must sum to 100. */
  maxPoints: number
  description: string
}

/** Explicit, weighted scoring rubric sent to the model. Weights sum to 100. */
export const DEFAULT_SCORING_CRITERIA: ScoringCriterion[] = [
  {
    key: 'intent',
    label: 'Buying intent',
    maxPoints: 25,
    description: 'The inquiry clearly asks for a service or product the business sells, rather than general questions.',
  },
  {
    key: 'fit',
    label: 'Service fit',
    maxPoints: 25,
    description: 'The request matches the services described in the business context.',
  },
  {
    key: 'budget_timeline',
    label: 'Budget & timeline',
    maxPoints: 20,
    description: 'The inquiry mentions a budget, deadline, or concrete project timing.',
  },
  {
    key: 'authority',
    label: 'Company & authority',
    maxPoints: 15,
    description: 'Business email domain, named company, and a job title with decision-making authority.',
  },
  {
    key: 'completeness',
    label: 'Detail & contactability',
    maxPoints: 15,
    description: 'Enough detail to act on and valid contact information.',
  },
]

export function validateThresholds(t: PriorityThresholds): boolean {
  return Number.isInteger(t.high) && Number.isInteger(t.medium) && t.medium >= 1 && t.high > t.medium && t.high <= 100
}

export function priorityFromScore(score: number, thresholds: PriorityThresholds = DEFAULT_PRIORITY_THRESHOLDS): LeadPriority {
  if (!Number.isFinite(score)) throw new RangeError('score must be a finite number')
  const s = clampScore(score)
  if (s >= thresholds.high) return 'high'
  if (s >= thresholds.medium) return 'medium'
  return 'low'
}

export function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)))
}

export interface CriterionScore {
  key: string
  score: number
}

export interface ReconciledScore {
  score: number
  priority: LeadPriority
  /** Human-readable notes about corrections the backend applied to the model output. */
  adjustments: string[]
}

/**
 * Turns the model's self-reported numbers into the persisted score.
 *
 * The model returns per-criterion scores and a total. The backend trusts neither blindly:
 * criterion scores are clamped to each criterion's maximum, and when the stated total drifts
 * from the criterion sum by more than SCORE_SUM_TOLERANCE the sum wins. Priority is always
 * derived from the final score so the same score can never map to two priorities.
 */
export function reconcileScore(
  statedScore: number,
  criteria: CriterionScore[],
  rubric: ScoringCriterion[],
  thresholds: PriorityThresholds = DEFAULT_PRIORITY_THRESHOLDS,
  statedPriority?: LeadPriority,
  category?: string,
): ReconciledScore {
  const adjustments: string[] = []
  let score = clampScore(statedScore)

  if (criteria.length > 0) {
    const maxByKey = new Map(rubric.map((c) => [c.key, c.maxPoints]))
    let sum = 0
    for (const c of criteria) {
      const max = maxByKey.get(c.key)
      if (max === undefined) {
        adjustments.push(`Ignored unknown criterion "${c.key}".`)
        continue
      }
      const clamped = Math.min(max, Math.max(0, Math.round(c.score)))
      if (clamped !== c.score) adjustments.push(`Clamped "${c.key}" from ${c.score} to ${clamped}.`)
      sum += clamped
    }
    if (Math.abs(sum - score) > SCORE_SUM_TOLERANCE) {
      adjustments.push(`Stated score ${score} differed from criterion total ${sum}; using criterion total.`)
      score = clampScore(sum)
    }
  }

  let priority = priorityFromScore(score, thresholds)
  if (category === 'spam' && priority !== 'low') {
    adjustments.push('Category "spam" forces low priority.')
    priority = 'low'
  }
  if (statedPriority && statedPriority !== priority) {
    adjustments.push(`Model suggested "${statedPriority}" priority; score ${score} maps to "${priority}".`)
  }
  return { score, priority, adjustments }
}

/** Completed qualifications with low confidence or a spam category are routed to human review. */
export function qualificationOutcome(
  confidence: number,
  category: string,
  reviewConfidence: number = DEFAULT_REVIEW_CONFIDENCE,
): Extract<QualificationStatus, 'completed' | 'needs_review'> {
  if (confidence < reviewConfidence || category === 'spam') return 'needs_review'
  return 'completed'
}
