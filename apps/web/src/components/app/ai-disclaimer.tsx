import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AiDisclaimerProps {
  /** Model id from the qualification record, e.g. "gemini-3.5-flash-lite". */
  model?: string | null
  className?: string
  children?: React.ReactNode
}

/** Label for AI-generated content: scores, summaries and recommendations are estimates. */
export function AiDisclaimer({ model, className, children }: AiDisclaimerProps) {
  return (
    <p className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', className)}>
      <Sparkles className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>
        {children ?? (
          <>
            AI-generated estimate{model ? <> by <span className="font-mono text-[11px]">{model}</span></> : null}. Review
            before acting on it.
          </>
        )}
      </span>
    </p>
  )
}
