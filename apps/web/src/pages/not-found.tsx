import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { LogoMark } from '@/components/app/logo'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 px-4 text-center">
      <LogoMark className="size-10" />
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary tabular-nums">404</p>
        <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist or has moved. Check the address, or head back to the app.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button render={<Link to="/" />} nativeButton={false}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Back to LeadPilot
        </Button>
        <Button variant="outline" render={<Link to="/preview/dashboard" />} nativeButton={false}>
          Open the preview
        </Button>
      </div>
    </main>
  )
}
