import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border',
  info: 'bg-info/10 text-info ring-info/20',
  success: 'bg-success/10 text-success ring-success/20',
  warning: 'bg-warning/10 text-warning ring-warning/25',
  danger: 'bg-danger/10 text-danger ring-danger/20',
}

const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/60',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

interface StatusBadgeProps {
  tone?: Tone
  /** `soft` = tinted pill; `dot` = neutral outline with a colored dot (for dense tables). */
  variant?: 'soft' | 'dot'
  icon?: ReactNode
  title?: string
  className?: string
  children: ReactNode
}

/** Base for every status-like badge. Always pair color with text (and ideally an icon). */
export function StatusBadge({ tone = 'neutral', variant = 'soft', icon, title, className, children }: StatusBadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset [&_svg]:size-3 [&_svg]:shrink-0',
        variant === 'soft' ? TONE_CLASSES[tone] : 'bg-background text-foreground ring-border',
        className,
      )}
    >
      {variant === 'dot' ? <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT_CLASSES[tone])} /> : icon}
      {children}
    </span>
  )
}
