import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface IntegrationCardProps {
  icon: LucideIcon
  title: string
  description: ReactNode
  status?: ReactNode
  children: ReactNode
  className?: string
}

export function IntegrationCard({ icon: Icon, title, description, status, children, className }: IntegrationCardProps) {
  return (
    <Card className={cn('shadow-xs', className)}>
      <CardHeader className="border-b">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm font-semibold">{title}</CardTitle>
              {status}
            </div>
            <CardDescription className="text-[13px]">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

/** Label/value rows (dl) used for integration status details. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[max-content_1fr]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card className="shadow-xs" aria-hidden="true">
      <CardHeader className="border-b">
        <div className="flex items-start gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}

/** Monospace snippet block with a copy action. */
export function CodeBlock({ code, label, copy }: { code: string; label: string; copy: ReactNode }) {
  return (
    <div className="relative rounded-lg border bg-muted/40">
      <div className="absolute top-1.5 right-1.5">{copy}</div>
      <pre aria-label={label} className="max-h-80 overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}
