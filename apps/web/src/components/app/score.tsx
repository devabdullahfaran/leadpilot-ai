import { DEFAULT_PRIORITY_THRESHOLDS, clampScore, priorityFromScore, type PriorityThresholds } from '@leadpilot/shared'
import { cn } from '@/lib/utils'
import { PRIORITY_SPEC } from './badge-specs'

const BAR_FILL = { high: 'bg-success', medium: 'bg-warning', low: 'bg-muted-foreground/50' } as const
const TEXT = { high: 'text-success', medium: 'text-warning', low: 'text-muted-foreground' } as const

interface ScoreProps {
  score: number | null | undefined
  /** Workspace thresholds from AI settings; defaults to the shared defaults (70 / 40). */
  thresholds?: PriorityThresholds
  className?: string
}

/** Compact "82" pill colored by the priority band the score falls into. */
export function ScoreBadge({ score, thresholds = DEFAULT_PRIORITY_THRESHOLDS, className }: ScoreProps) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return <span className={cn('text-sm text-muted-foreground', className)}>—</span>
  }
  const value = clampScore(score)
  const band = priorityFromScore(value, thresholds)
  return (
    <span
      title={`Score ${value} / 100 · ${PRIORITY_SPEC[band].label} priority band`}
      className={cn('inline-flex h-5 min-w-8 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums', TEXT[band], className)}
    >
      {value}
    </span>
  )
}

/** Horizontal 0–100 meter with the numeric value. Accessible as a meter. */
export function ScoreBar({ score, thresholds = DEFAULT_PRIORITY_THRESHOLDS, className, showValue = true }: ScoreProps & { showValue?: boolean }) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return <span className={cn('text-sm text-muted-foreground', className)}>Not scored</span>
  }
  const value = clampScore(score)
  const band = priorityFromScore(value, thresholds)
  return (
    <div className={cn('flex min-w-24 items-center gap-2', className)}>
      <div
        role="meter"
        aria-label="Lead score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value} out of 100, ${PRIORITY_SPEC[band].label.toLowerCase()} priority`}
        data-band={band}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn('h-full rounded-full transition-[width]', BAR_FILL[band])} style={{ width: `${value}%` }} />
      </div>
      {showValue ? <span className="w-7 text-right text-xs font-medium tabular-nums text-foreground">{value}</span> : null}
    </div>
  )
}
