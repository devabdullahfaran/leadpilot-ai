import { cloneElement, type ReactElement } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useMutationGuard, type MutationGuardOptions } from './use-mutation-guard'

interface ReadOnlyGuardProps extends MutationGuardOptions {
  /** A single control that accepts `disabled` (Button, Switch, …). */
  children: ReactElement<{ disabled?: boolean }>
  /** Extra app-specific reason to disable (e.g. "Configure Slack first"). */
  disabledReason?: string | null
  className?: string
}

/**
 * Wraps a mutating control. In preview mode (or without the required role) the control is disabled
 * and a focusable wrapper explains why in a tooltip — it is never hidden or faked.
 */
export function ReadOnlyGuard({ children, action, minRole, disabledReason, className }: ReadOnlyGuardProps) {
  const guard = useMutationGuard({ action, minRole })
  const reason = guard.reason ?? disabledReason ?? null
  if (!reason) return children

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        data-slot="read-only-guard"
        className={cn('inline-flex cursor-not-allowed rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}
      >
        {cloneElement(children, { disabled: true })}
        <span className="sr-only">{reason}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}
