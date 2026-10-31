import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { getConfig } from './env'
import { createServiceDb } from './lib/db'
import { ApiError, errorResponse } from './lib/errors'
import { log } from './lib/logger'
import { requireAuth, requireWorkspace } from './middleware/auth'
import { demoScope } from './middleware/demo'
import { rateLimit } from './middleware/rate-limit'
import { analyticsRoutes } from './routes/analytics'
import { dashboardRoutes } from './routes/dashboard'
import { intakeRoutes } from './routes/intake'
import { integrationRoutes } from './routes/integrations'
import { leadRoutes } from './routes/leads'
import { sessionRoutes } from './routes/session'
import { settingsRoutes } from './routes/settings'
import { workflowRoutes } from './routes/workflows'
import type { AppEnv, Deps } from './types'

export const API_VERSION = '0.1.0'

/** Resource routers mounted for signed-in users and, read-only, for the public portfolio preview. */
const RESOURCES: [path: string, router: Hono<AppEnv>][] = [
  ['/dashboard', dashboardRoutes],
  ['/leads', leadRoutes],
  ['/workflows', workflowRoutes],
  ['/analytics', analyticsRoutes],
  ['/integrations', integrationRoutes],
  ['/settings', settingsRoutes],
]

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    externalFetch: overrides.externalFetch ?? ((input, init) => fetch(input, init)),
    now: overrides.now ?? (() => new Date()),
  }
  const app = new Hono<AppEnv>()

  // Request context + structured access log.
  app.use('*', async (c, next) => {
    const started = Date.now()
    const requestId = crypto.randomUUID()
    c.set('requestId', requestId)
    c.set('deps', deps)
    c.header('X-Request-Id', requestId)
    try {
      const config = getConfig(c.env)
      c.set('config', config)
      c.set('serviceDb', createServiceDb(config))
      await next()
    } catch (err) {
      // Configuration errors surface here before onError has a usable context.
      c.res = errorResponse(c, err)
    } finally {
      log(c.res.status >= 500 ? 'error' : 'info', 'request', {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - started,
        userId: c.get('user')?.id,
      })
    }
  })

  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => {
        // Website forms embedded on any domain may post to the intake webhook (protected by an intake key).
        if (c.req.path.startsWith('/api/v1/intake/')) return origin || '*'
        const allowed = c.get('config')?.allowedOrigins ?? []
        return allowed.includes(origin) ? origin : null
      },
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'X-Workspace-Id', 'Idempotency-Key', 'X-Intake-Key'],
      exposeHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  )

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new ApiError(413, 'payload_too_large', 'Request body exceeds 64 KB')
      },
    }),
  )

  app.get('/api/v1/health', (c) =>
    c.json({ status: 'ok', version: API_VERSION, environment: c.get('config').environment, time: deps.now().toISOString() }),
  )

  // Public webhook intake (authenticated by a per-workspace intake key, not a user session).
  app.route('/api/v1/intake', intakeRoutes)

  // Session info does not require an active workspace.
  const me = new Hono<AppEnv>()
  me.use('*', requireAuth, rateLimit('api'))
  me.route('/', sessionRoutes)
  app.route('/api/v1/me', me)

  for (const [path, router] of RESOURCES) {
    const user = new Hono<AppEnv>()
    user.use('*', requireAuth, requireWorkspace, rateLimit('api'))
    user.route('/', router)
    app.route(`/api/v1${path}`, user)

    const demo = new Hono<AppEnv>()
    demo.use('*', rateLimit('api'), demoScope)
    demo.route('/', router)
    app.route(`/api/v1/demo${path}`, demo)
  }

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found', requestId: c.get('requestId') } }, 404))
  app.onError((err, c) => errorResponse(c, err))

  return app
}
