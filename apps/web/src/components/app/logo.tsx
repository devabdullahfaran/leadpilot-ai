import { cn } from '@/lib/utils'

/** Square brand mark (matches public/favicon.svg). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M10 9v14h12" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M15 17.5l3.5-4 3.5 2.5"
        stroke="white"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".85"
      />
    </svg>
  )
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={markClassName} />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">LeadPilot</span>
    </span>
  )
}
