import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Info, Minus, type LucideIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface StatDelta {
  /** Signed change. Only pass a delta the API actually provides — never derive one from guesses. */
  value: number
  /** e.g. "vs previous 7 days" */
  label?: string
  formatter?: (value: number) => string
  /** Set when a decrease is the good direction (e.g. failures). */
  invert?: boolean
}

interface StatCardProps {
  label: string
  /** Pre-formatted value. `null`/`undefined` renders an em dash. */
  value: ReactNode
  /** Definition of the metric, shown in a tooltip next to the label. */
  hint?: string
  icon?: LucideIcon
  delta?: StatDelta
  /** Secondary line under the value, e.g. "of 50 daily calls". */
  footer?: ReactNode
  loading?: boolean
  className?: string
}

export function StatCard({ label, value, hint, icon: Icon, delta, footer, loading, className }: StatCardProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs', className)}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              aria-label={`About ${label}`}
              className="-m-1 inline-flex rounded-sm p-1 text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{hint}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value ?? '—'}</span>
          {delta ? <DeltaPill delta={delta} /> : null}
        </div>
      )}
      {footer && !loading ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  )
}

function DeltaPill({ delta }: { delta: StatDelta }) {
  const { value, label, formatter = (v: number) => formatNumber(Math.abs(v)), invert } = delta
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const good = direction === 'flat' ? null : (direction === 'up') !== Boolean(invert)
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
        good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-danger',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'No change'}</span>
      {formatter(value)}
      {label ? <span className="font-normal text-muted-foreground">{label}</span> : null}
    </span>
  )
}
