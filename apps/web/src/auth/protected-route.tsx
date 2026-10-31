import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { FullPageLoader } from '@/components/app/full-page-loader'
import { useAuth } from './auth-context'

/** Renders children only for signed-in users; otherwise redirects to /login?next=<current path>. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageLoader label="Checking your session" />
  if (!session) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}
