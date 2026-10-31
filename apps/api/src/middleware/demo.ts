import { createMiddleware } from 'hono/factory'
import { ApiError, unwrap } from '../lib/errors'
import type { AppEnv } from '../types'

let cached: { id: string; expires: number } | null = null
const TTL_MS = 5 * 60 * 1000

/**
 * Public portfolio preview: a read-only scope pinned to the single `is_demo` workspace, which contains
 * only synthetic records flagged `is_sample`. Uses the service client, so handlers MUST filter by
 * scope.workspaceId (see Scope docs). Mutations are rejected by requireWrite().
 */
export const demoScope = createMiddleware<AppEnv>(async (c, next) => {
  const now = Date.now()
  if (!cached || cached.expires < now) {
    const row = unwrap(
      await c.get('serviceDb').from('workspaces').select('id').eq('is_demo', true).maybeSingle<{ id: string }>(),
      'demo.workspace',
    )
    if (!row) throw new ApiError(404, 'not_found', 'The portfolio preview has not been seeded yet')
    cached = { id: row.id, expires: now + TTL_MS }
  }
  c.set('scope', {
    mode: 'demo',
    workspaceId: cached.id,
    role: 'viewer',
    userId: null,
    db: c.get('serviceDb'),
    readOnly: true,
  })
  c.header('Cache-Control', 'public, max-age=30')
  await next()
})

/** Test hook. */
export function resetDemoCache(): void {
  cached = null
}
