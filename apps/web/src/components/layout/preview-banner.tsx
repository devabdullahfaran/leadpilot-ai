import { Eye } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'

/** Persistent strip shown on every preview page. */
export function PreviewBanner() {
  const { session } = useAuth()
  return (
    <div
      role="region"
      aria-label="Preview mode"
      className="flex items-center gap-3 border-b border-primary/15 bg-[oklch(0.97_0.016_258)] dark:bg-[oklch(0.23_0.03_258)] px-4 py-2 text-[13px] text-foreground sm:px-6"
    >
      <Eye className="hidden size-4 shrink-0 text-primary sm:block" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Portfolio preview — read-only sample data.</span>{' '}
        <span className="text-muted-foreground">Sign in to create leads and run live AI qualification.</span>
      </p>
      <Button size="xs" render={<Link to={session ? '/dashboard' : '/login'} />} nativeButton={false}>
        {session ? 'Open workspace' : 'Sign in'}
      </Button>
    </div>
  )
}
