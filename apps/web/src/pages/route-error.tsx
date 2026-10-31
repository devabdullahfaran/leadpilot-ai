import { RefreshCw } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { LogoMark } from '@/components/app/logo'
import { Button } from '@/components/ui/button'
import { NotFoundPage } from './not-found'

/** Last-resort boundary for render errors and failed lazy chunks (e.g. after a deploy). */
export function RouteErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.'

  return (
    <main role="alert" className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 px-4 text-center">
      <LogoMark className="size-10" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">This page failed to load</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Reloading usually fixes it, especially right after an update. If it keeps happening, the details below help us
          find the cause.
        </p>
        <pre className="mx-auto max-w-md overflow-x-auto rounded-md border bg-background px-3 py-2 text-left font-mono text-xs text-muted-foreground">
          {message}
        </pre>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => window.location.reload()}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          Reload
        </Button>
        <Button variant="outline" render={<Link to="/" />} nativeButton={false}>
          Go home
        </Button>
      </div>
    </main>
  )
}
