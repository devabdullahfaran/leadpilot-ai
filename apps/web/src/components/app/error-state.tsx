import { CircleAlert, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { errorMessage, isApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

interface ErrorStateProps {
  error: unknown
  title?: string
  onRetry?: () => void
  retrying?: boolean
  size?: 'default' | 'compact'
  className?: string
}

/** Failed request: the API's message, its request ID (for support/logs) and a retry. */
export function ErrorState({ error, title, onRetry, retrying, size = 'default', className }: ErrorStateProps) {
  const apiError = isApiClientError(error) ? error : null
  const offline = apiError?.code === 'network_error'
  const Icon = offline ? WifiOff : CircleAlert
  const heading = title ?? (offline ? 'Can’t reach the server' : apiError?.code === 'not_found' ? 'Not found' : 'Something went wrong')

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        size === 'default' ? 'rounded-xl border border-dashed px-6 py-12' : 'px-4 py-8',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-danger/10 text-danger">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium text-foreground">{heading}</p>
        <p className="text-sm text-muted-foreground">{errorMessage(error)}</p>
        {apiError?.requestId ? (
          <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <span>Request ID</span>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{apiError.requestId}</code>
            <CopyButton value={apiError.requestId} label="Copy request ID" />
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn(retrying && 'animate-spin')} aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}
