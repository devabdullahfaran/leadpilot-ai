import { Navigate, Outlet, ScrollRestoration } from 'react-router'
import { AuthProvider } from '@/auth/auth-provider'
import { useAuth } from '@/auth/auth-context'
import { FullPageLoader } from '@/components/app/full-page-loader'

export function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
      <ScrollRestoration />
    </AuthProvider>
  )
}

/** `/` → the app when signed in, otherwise the login page. */
export function RootRedirect() {
  const { session, loading } = useAuth()
  if (loading) return <FullPageLoader />
  return <Navigate to={session ? '/dashboard' : '/login'} replace />
}
