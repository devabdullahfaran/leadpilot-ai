import { useMemo, useState } from 'react'
import { Building2, LogOut } from 'lucide-react'
import { Link, Outlet } from 'react-router'
import { useDataMode } from '@/app/data-mode'
import { useWorkspace } from '@/app/workspace'
import { useAuth } from '@/auth/auth-context'
import { EmptyState } from '@/components/app/empty-state'
import { ErrorState } from '@/components/app/error-state'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { AppSidebar } from './app-sidebar'
import { PageTitleContext } from './page-title'
import { PreviewBanner } from './preview-banner'
import { Topbar } from './topbar'

function ContentSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading workspace">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

function WorkspaceGate() {
  const { status, error, retry } = useWorkspace()
  const { signOut } = useAuth()

  if (status === 'loading') return <ContentSkeleton />
  if (status === 'error') return <ErrorState error={error} title="Couldn’t load your account" onRetry={retry} />
  if (status === 'empty') {
    return (
      <EmptyState
        icon={Building2}
        title="No workspace yet"
        description="Your account is not a member of any workspace. A workspace is created when you sign up; if this persists, sign out and back in, or ask a workspace admin to invite you."
        action={
          <>
            <Button variant="outline" size="sm" onClick={retry}>
              Check again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
            <Button variant="ghost" size="sm" render={<Link to="/preview/dashboard" />} nativeButton={false}>
              Explore the preview
            </Button>
          </>
        }
      />
    )
  }
  return <Outlet />
}

/** Sidebar + topbar layout shared by the signed-in app and the read-only preview. */
export function AppShell() {
  const { mode } = useDataMode()
  const [title, setTitle] = useState<string | null>(null)
  const titleContext = useMemo(() => ({ title, setTitle }), [title])
  // Mirrors the cookie written by SidebarProvider so the collapsed state survives reloads.
  const [defaultOpen] = useState(() => !document.cookie.includes('sidebar_state=false'))

  return (
    <PageTitleContext.Provider value={titleContext}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <div className="sticky top-0 z-20">
            {mode === 'demo' ? <PreviewBanner /> : null}
            <Topbar />
          </div>
          <div id="main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            {mode === 'demo' ? <Outlet /> : <WorkspaceGate />}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </PageTitleContext.Provider>
  )
}
