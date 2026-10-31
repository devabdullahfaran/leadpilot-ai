import { useEffect, useState } from 'react'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/** "3 hours ago" with the absolute time in the tooltip; re-renders every minute. */
export function RelativeTime({ value, className }: { value: string | null | undefined; className?: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  if (!value) return <span className={cn('text-muted-foreground', className)}>—</span>
  return (
    <time dateTime={value} title={formatDateTime(value)} className={cn('whitespace-nowrap', className)}>
      {formatRelativeTime(value, now)}
    </time>
  )
}
