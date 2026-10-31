import { describe, expect, it } from 'vitest'
import {
  clampScore,
  DEFAULT_SCORING_CRITERIA,
  priorityFromScore,
  qualificationOutcome,
  reconcileScore,
  SCORE_SUM_TOLERANCE,
  validateThresholds,
} from '../src/scoring'

describe('priorityFromScore', () => {
  it.each([
    [0, 'low'],
    [39, 'low'],
    [40, 'medium'],
    [69, 'medium'],
    [70, 'high'],
    [100, 'high'],
  ] as const)('default thresholds: %i → %s', (score, priority) => {
    expect(priorityFromScore(score)).toBe(priority)
  })

  it('respects custom thresholds (inclusive lower bounds)', () => {
    const t = { high: 80, medium: 50 }
    expect(priorityFromScore(79, t)).toBe('medium')
    expect(priorityFromScore(80, t)).toBe('high')
    expect(priorityFromScore(49, t)).toBe('low')
    expect(priorityFromScore(50, t)).toBe('medium')
  })

  it('clamps and rounds out-of-range scores, and rejects non-finite input', () => {
    expect(priorityFromScore(-5)).toBe('low')
    expect(priorityFromScore(250)).toBe('high')
    expect(priorityFromScore(69.5)).toBe('high')
    expect(() => priorityFromScore(Number.NaN)).toThrow(RangeError)
    expect(() => priorityFromScore(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('clampScore / validateThresholds', () => {
  it('clamps to 0..100 integers', () => {
    expect(clampScore(-1)).toBe(0)
    expect(clampScore(101)).toBe(100)
    expect(clampScore(42.4)).toBe(42)
  })
  it('validates threshold ordering', () => {
    expect(validateThresholds({ high: 70, medium: 40 })).toBe(true)
    expect(validateThresholds({ high: 40, medium: 40 })).toBe(false)
    expect(validateThresholds({ high: 70, medium: 0 })).toBe(false)
    expect(validateThresholds({ high: 101, medium: 40 })).toBe(false)
    expect(validateThresholds({ high: 70.5, medium: 40 })).toBe(false)
  })
})

describe('reconcileScore', () => {
  const rubric = DEFAULT_SCORING_CRITERIA // intent 25, fit 25, budget_timeline 20, authority 15, completeness 15
  const criteria = [
    { key: 'intent', score: 20 },
    { key: 'fit', score: 20 },
    { key: 'budget_timeline', score: 10 },
    { key: 'authority', score: 10 },
    { key: 'completeness', score: 10 },
  ] // sum 70

  it('keeps the stated score when it is within tolerance of the criteria sum', () => {
    const r = reconcileScore(70 + SCORE_SUM_TOLERANCE, criteria, rubric)
    expect(r.score).toBe(75)
    expect(r.priority).toBe('high')
    expect(r.adjustments).toEqual([])
  })

  it('uses the criteria sum when the stated score drifts beyond tolerance', () => {
    const r = reconcileScore(95, criteria, rubric)
    expect(r.score).toBe(70)
    expect(r.adjustments.join(' ')).toMatch(/differed from criterion total 70/)
  })

  it('clamps criterion scores to their maximum before summing', () => {
    const r = reconcileScore(100, [{ key: 'intent', score: 60 }, { key: 'fit', score: 25 }], rubric)
    expect(r.score).toBe(50)
    expect(r.adjustments).toContain('Clamped "intent" from 60 to 25.')
  })

  it('ignores unknown and duplicate criteria', () => {
    const r = reconcileScore(
      30,
      [
        { key: 'intent', score: 15 },
        { key: 'intent', score: 15 },
        { key: 'vibes', score: 50 },
        { key: 'fit', score: 15 },
      ],
      rubric,
    )
    expect(r.score).toBe(30)
    expect(r.adjustments).toContain('Ignored unknown criterion "vibes".')
    expect(r.adjustments).toContain('Ignored duplicate criterion "intent".')
  })

  it('clamps the stated score when no criteria are returned', () => {
    expect(reconcileScore(140, [], rubric)).toMatchObject({ score: 100, priority: 'high', adjustments: [] })
  })

  it('forces spam to low priority', () => {
    const r = reconcileScore(75, criteria, rubric, undefined, 'high', 'spam')
    expect(r.priority).toBe('low')
    expect(r.adjustments).toContain('Category "spam" forces low priority.')
  })

  it('derives priority from the score and notes a disagreeing model priority', () => {
    const r = reconcileScore(70, criteria, rubric, { high: 80, medium: 50 }, 'high')
    expect(r.priority).toBe('medium')
    expect(r.adjustments).toContain('Model suggested "high" priority; score 70 maps to "medium".')
  })
})

describe('qualificationOutcome', () => {
  it('routes low confidence and spam to review', () => {
    expect(qualificationOutcome(0.9, 'software_development')).toBe('completed')
    expect(qualificationOutcome(0.6, 'software_development')).toBe('completed')
    expect(qualificationOutcome(0.59, 'software_development')).toBe('needs_review')
    expect(qualificationOutcome(0.99, 'spam')).toBe('needs_review')
    expect(qualificationOutcome(0.7, 'consulting', 0.8)).toBe('needs_review')
  })
})
