// Users, memberships and role switching for database-level authorization tests.
import { randomUUID } from 'node:crypto'
import type { WorkspaceRole } from '@leadpilot/shared'
import type pg from 'pg'
import type { Queryable } from './pg'

export interface TestUser {
  id: string
  email: string
  /** Personal workspace provisioned by the on_auth_user_created trigger (user is its owner). */
  workspaceId: string
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@example.test`

/**
 * Inserts into auth.users (as Supabase Auth would). The signup trigger provisions the profile, a personal
 * workspace and the owner membership; this returns that workspace.
 */
export async function createAuthUser(
  client: Queryable,
  opts: { email?: string; fullName?: string } = {},
): Promise<TestUser> {
  const email = opts.email ?? uniqueEmail()
  const meta = opts.fullName ? { full_name: opts.fullName } : {}
  const { rows } = await client.query<{ id: string }>(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
    [email, JSON.stringify(meta)],
  )
  const id = rows[0].id
  const ws = await client.query<{ workspace_id: string }>(
    "select workspace_id from public.workspace_members where user_id = $1 and role = 'owner'",
    [id],
  )
  if (ws.rows.length !== 1) throw new Error(`signup trigger did not provision a workspace for ${email}`)
  return { id, email, workspaceId: ws.rows[0].workspace_id }
}

export async function addMember(client: Queryable, workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  await client.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, $3)
     on conflict (workspace_id, user_id) do update set role = excluded.role`,
    [workspaceId, userId, role],
  )
}

/** Creates a user and adds them to an existing workspace with the given role. */
export async function createMember(client: Queryable, workspaceId: string, role: WorkspaceRole, prefix: string = role): Promise<TestUser> {
  const user = await createAuthUser(client, { email: uniqueEmail(prefix) })
  await addMember(client, workspaceId, user.id, role)
  return user
}

type DbRole = 'authenticated' | 'anon' | 'service_role'

/**
 * Runs fn in a transaction as a PostgREST request would: SET LOCAL ROLE plus request.jwt.claims.
 * Commits when fn resolves, rolls back (and rethrows) when it throws, so a failed statement never leaks
 * the role or an aborted transaction into the next query.
 */
async function asRole<T>(client: pg.Client, role: DbRole, claims: Record<string, unknown>, fn: (db: pg.Client) => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback')
    throw err
  }
}

export function asUser<T>(client: pg.Client, userId: string, fn: (db: pg.Client) => Promise<T>): Promise<T> {
  return asRole(client, 'authenticated', { sub: userId, role: 'authenticated', aud: 'authenticated' }, fn)
}

export function asAnon<T>(client: pg.Client, fn: (db: pg.Client) => Promise<T>): Promise<T> {
  return asRole(client, 'anon', { role: 'anon' }, fn)
}

export function asService<T>(client: pg.Client, fn: (db: pg.Client) => Promise<T>): Promise<T> {
  return asRole(client, 'service_role', { role: 'service_role' }, fn)
}

/** Postgres error codes asserted by the tests. */
export const PG = {
  insufficientPrivilege: '42501',
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  generatedAlways: '428C9',
} as const

/** Resolves with the Postgres error a promise rejected with; fails when it did not reject. */
export async function pgError(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return { code: e.code ?? '', message: e.message ?? String(err) }
  }
  throw new Error('expected the query to fail, but it succeeded')
}
