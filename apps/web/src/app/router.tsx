import { Navigate, createBrowserRouter, type RouteObject } from 'react-router'
import { ProtectedRoute } from '@/auth/protected-route'
import { FullPageLoader } from '@/components/app/full-page-loader'
import { AppShell } from '@/components/layout/app-shell'
import type { RouteHandle } from '@/components/layout/nav'
import { ForgotPasswordPage } from '@/pages/auth/forgot-password'
import { LoginPage } from '@/pages/auth/login'
import { RegisterPage } from '@/pages/auth/register'
import { ResetPasswordPage } from '@/pages/auth/reset-password'
import { NotFoundPage } from '@/pages/not-found'
import { RouteErrorPage } from '@/pages/route-error'
import { DataModeProvider } from './data-mode-provider'
import { RootLayout, RootRedirect } from './root-layout'
import { WorkspaceProvider } from './workspace-provider'

const handle = (crumb: string, parent?: RouteHandle['parent']): RouteHandle => ({ crumb, parent })

/**
 * The page routes, mounted twice: under / for signed-in users and under /preview for the public
 * read-only preview. Pages are code-split; each module exports a named component.
 */
function pageRoutes(): RouteObject[] {
  return [
    {
      path: 'dashboard',
      handle: handle('Dashboard'),
      lazy: async () => ({ Component: (await import('@/pages/dashboard')).DashboardPage }),
    },
    {
      path: 'analytics',
      handle: handle('Analytics'),
      lazy: async () => ({ Component: (await import('@/pages/analytics')).AnalyticsPage }),
    },
    {
      path: 'leads',
      handle: handle('Leads'),
      lazy: async () => ({ Component: (await import('@/pages/leads')).LeadsPage }),
    },
    {
      path: 'leads/:leadId',
      handle: handle('Lead', { label: 'Leads', path: '/leads' }),
      lazy: async () => ({ Component: (await import('@/pages/leads/lead-detail')).LeadDetailPage }),
    },
    {
      path: 'qualification',
      handle: handle('AI Qualification'),
      lazy: async () => ({ Component: (await import('@/pages/qualification')).QualificationPage }),
    },
    {
      path: 'workflows',
      handle: handle('Workflows'),
      lazy: async () => ({ Component: (await import('@/pages/workflows')).WorkflowsPage }),
    },
    {
      path: 'integrations',
      handle: handle('Integrations'),
      lazy: async () => ({ Component: (await import('@/pages/integrations')).IntegrationsPage }),
    },
    {
      path: 'settings',
      handle: handle('Settings'),
      lazy: async () => ({ Component: (await import('@/pages/settings')).SettingsPage }),
    },
  ]
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      {
        element: (
          <ProtectedRoute>
            <DataModeProvider mode="user">
              <WorkspaceProvider>
                <AppShell />
              </WorkspaceProvider>
            </DataModeProvider>
          </ProtectedRoute>
        ),
        children: pageRoutes(),
      },
      {
        path: 'preview',
        element: (
          <DataModeProvider mode="demo">
            <WorkspaceProvider>
              <AppShell />
            </WorkspaceProvider>
          </DataModeProvider>
        ),
        children: [{ index: true, element: <Navigate to="/preview/dashboard" replace /> }, ...pageRoutes()],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routes)
}
