import type { ReactNode } from 'react'
import { Inbox, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  /** Why it is empty and what to do next. */
  description?: ReactNode
  icon?: LucideIcon
  /** The next action (button/link). Wrap mutating actions in <ReadOnlyGuard>. */
  action?: ReactNode
  /** `compact` for use inside cards and tables. */
  size?: 'default' | 'compact'
  className?: string
}

export function EmptyState({ title, description, icon: Icon = Inbox, action, size = 'default', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'default' ? 'gap-3 rounded-xl border border-dashed px-6 py-12' : 'gap-2 px-4 py-8',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-xs',
          size === 'default' ? 'size-10' : 'size-8',
        )}
      >
        <Icon className={size === 'default' ? 'size-5' : 'size-4'} aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}
