import type { ReactNode } from 'react'
import { ArrowRight, Info } from 'lucide-react'
import { Link } from 'react-router'
import { LogoMark } from '@/components/app/logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface AuthLayoutProps {
  title: string
  description?: ReactNode
  children: ReactNode
  /** Links under the card, e.g. "Don't have an account? Create one". */
  footer?: ReactNode
}

/** Centered card for sign-in flows, with the product mark and the route into the public preview. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <Link to="/" aria-label="LeadPilot AI home" className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <LogoMark className="size-10" />
            </Link>
            <div className="space-y-1">
              <p className="text-sm font-semibold tracking-tight text-foreground">LeadPilot AI</p>
              <p className="text-sm text-muted-foreground">Qualify inbound leads with AI and keep your CRM in sync.</p>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="mb-5 space-y-1">
              <h1 className="text-lg font-semibold text-foreground">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {children}
          </div>

          {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}

          <div className="mt-8 border-t pt-6 text-center">
            <Button variant="outline" className="w-full" render={<Link to="/preview/dashboard" />} nativeButton={false}>
              Explore the read-only portfolio preview
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">No account needed. Synthetic sample data only.</p>
          </div>
        </div>
      </main>
    </div>
  )
}

/** Shown instead of auth forms when the deployment has no Supabase configuration. */
export function AuthUnavailable() {
  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>Sign-in is unavailable in this deployment</AlertTitle>
      <AlertDescription>
        This instance runs without an authentication backend, so accounts can’t be created or used here. You can still
        explore every screen in the read-only portfolio preview below.
      </AlertDescription>
    </Alert>
  )
}
