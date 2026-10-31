import type { ExecutionStep, StepStatus } from '@leadpilot/shared'
import { CircleCheck, CircleMinus, CircleX } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { STEP_LABEL } from './labels'

const STEP_ICON: Record<StepStatus, { icon: typeof CircleCheck; className: string; label: string }> = {
  succeeded: { icon: CircleCheck, className: 'text-success', label: 'Succeeded' },
  failed: { icon: CircleX, className: 'text-danger', label: 'Failed' },
  skipped: { icon: CircleMinus, className: 'text-muted-foreground', label: 'Skipped' },
}

/** The steps an execution actually recorded, in order, with status, duration, attempts and message. */
export function StepTimeline({ steps }: { steps: ExecutionStep[] }) {
  if (steps.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No steps were recorded for this execution.</p>
  }
  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const spec = STEP_ICON[step.status]
        const Icon = spec.icon
        const last = index === steps.length - 1
        return (
          <li key={`${step.key}-${index}`} className="relative flex gap-3 pb-3 last:pb-0">
            {!last ? <span aria-hidden="true" className="absolute top-5 bottom-0 left-[7px] w-px bg-border" /> : null}
            <Icon className={cn('mt-0.5 size-4 shrink-0', spec.className)} aria-label={spec.label} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
                <span className="font-medium text-foreground">
                  {STEP_LABEL[step.key] ?? step.key}
                  <span className="sr-only"> — {spec.label}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {step.attempts && step.attempts > 1 ? <span>{step.attempts} attempts</span> : null}
                  <span>{formatDuration(step.durationMs)}</span>
                </span>
              </div>
              {step.message ? <p className="text-xs break-words text-muted-foreground">{step.message}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
