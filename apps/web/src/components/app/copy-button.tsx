import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  value: string
  /** Accessible name, e.g. "Copy request ID". */
  label?: string
  /** Visible text; omit for an icon-only button. */
  children?: React.ReactNode
  size?: 'icon-xs' | 'icon-sm' | 'xs' | 'sm'
  variant?: 'ghost' | 'outline'
  className?: string
}

export function CopyButton({ value, label = 'Copy to clipboard', children, size, variant = 'ghost', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.')
    }
  }

  const Icon = copied ? Check : Copy
  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (children ? 'xs' : 'icon-xs')}
      onClick={copy}
      aria-label={children ? undefined : label}
      title={label}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <Icon className={copied ? 'text-success' : undefined} aria-hidden="true" />
      {children}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </Button>
  )
}
