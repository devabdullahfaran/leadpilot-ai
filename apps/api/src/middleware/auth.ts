import type { WorkspaceRole, WorkspaceSummary } from '@leadpilot/shared'
import { createMiddleware } from 'hono/factory'
import { createUserDb } from '../lib/db'
import { forbidden, unauthorized, unwrap } from '../lib/errors'
import { verifyAccessToken } from '../lib/jwt'
import type { AppEnv } from '../types'

interface MembershipRow {
  role: WorkspaceRole
  created_at: string
  workspace: { id: string; name: string; slug: string; is_demo: boolean } | null
}

/**
 * Requires a valid Supabase access token, loads the caller's workspace memberships (through RLS) and
 * resolves the active workspace from the X-Workspace-Id header (defaults to the oldest membership).
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) throw unauthorized()
  const token = match[1].trim()

  const config = c.get('config')
  const user = await verifyAccessToken(token, config)
  const db = createUserDb(config, token)

  const rows = unwrap(
    await db
      .from('workspace_members')
      .select('role, created_at, workspace:workspaces!inner(id, name, slug, is_demo)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .returns<MembershipRow[]>(),
    'auth.memberships',
  )

  const workspaces: WorkspaceSummary[] = (rows ?? [])
    .filter((r) => r.workspace)
    .map((r) => ({
      id: r.workspace!.id,
      name: r.workspace!.name,
      slug: r.workspace!.slug,
      role: r.role,
      isDemo: r.workspace!.is_demo,
    }))

  const requested = c.req.header('X-Workspace-Id')
  const active = requested ? workspaces.find((w) => w.id === requested) : workspaces[0]
  if (requested && !active) throw forbidden('You are not a member of this workspace')

  c.set('user', user)
  c.set('workspaces', workspaces)
  if (active) {
    c.set('scope', {
      mode: 'user',
      workspaceId: active.id,
      role: active.role,
      userId: user.id,
      db,
      readOnly: false,
    })
  }
  await next()
})

/** For routes that operate on a workspace: fails if the user has none (e.g. provisioning failed). */
export const requireWorkspace = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('scope')) throw forbidden('No workspace is available for this account')
  await next()
})
