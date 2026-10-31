import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'

interface SectionCardProps {
  title: string
  description?: string
  /** Optional "View all" style link (mode-aware path). */
  link?: { to: string; label: string }
  children: ReactNode
  className?: string
  contentClassName?: string
}

/** Card with a compact header used by every dashboard/analytics panel. */
export function SectionCard({ title, description, link, children, className, contentClassName }: SectionCardProps) {
  return (
    <Card className={cn('gap-3 shadow-xs', className)}>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description ? <CardDescription className="text-[13px]">{description}</CardDescription> : null}
        {link ? (
          <CardAction>
            <Link
              to={link.to}
              className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {link.label}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={cn('min-w-0', contentClassName)}>{children}</CardContent>
    </Card>
  )
}

/** Shown when an aggregate includes synthetic sample records. */
export function SampleNotice({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      Includes {pluralize(count, 'sample record')} (synthetic data, labeled “Sample”).
    </p>
  )
}

export function SectionSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  )
}
