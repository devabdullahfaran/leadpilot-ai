import { profileUpdateSchema, type SessionInfo } from '@leadpilot/shared'
import { Hono, type Context } from 'hono'
import { createUserDb, type Db } from '../lib/db'
import { notFound, unauthorized, unwrap } from '../lib/errors'
import { readJson } from '../lib/http'
import type { AppEnv, Scope } from '../types'

export const sessionRoutes = new Hono<AppEnv>()

/** RLS-scoped client for the caller. Users without a workspace have no scope, so build one from the token. */
function userDb(c: Context<AppEnv>): Db {
  const scope = c.get('scope') as Scope | undefined
  if (scope?.mode === 'user') return scope.db
  const token = /^Bearer\s+(.+)$/i.exec(c.req.header('Authorization') ?? '')?.[1]?.trim()
  if (!token) throw unauthorized()
  return createUserDb(c.get('config'), token)
}

sessionRoutes.get('/', async (c) => {
  const user = c.get('user')
  const scope = c.get('scope') as Scope | undefined
  const profile = unwrap(
    await userDb(c).from('profiles').select('full_name').eq('id', user.id).maybeSingle<{ full_name: string | null }>(),
    'session.profile',
  )
  const body: SessionInfo = {
    user: { id: user.id, email: user.email, fullName: profile?.full_name ?? null },
    workspaces: c.get('workspaces') ?? [],
    activeWorkspaceId: scope?.workspaceId ?? null,
  }
  return c.json(body)
})

sessionRoutes.patch('/profile', async (c) => {
  const user = c.get('user')
  const body = await readJson(c, profileUpdateSchema)
  // RLS (profiles_update_self) and the full_name column grant limit this to the caller's own row.
  const row = unwrap(
    await userDb(c)
      .from('profiles')
      .update({ full_name: body.fullName })
      .eq('id', user.id)
      .select('full_name')
      .maybeSingle<{ full_name: string | null }>(),
    'session.updateProfile',
  )
  if (!row) throw notFound('Profile')
  return c.json({ fullName: row.full_name })
})
