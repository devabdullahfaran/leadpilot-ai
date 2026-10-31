import { ROLE_RANK, type WorkspaceRole } from '@leadpilot/shared'
import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv, Scope } from '../types'
import { badRequest, forbidden, readOnly } from './errors'

/** Parses a JSON body with a Zod schema. Malformed JSON → 400; schema violations → 422 (via ZodError). */
export async function readJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
  return schema.parse(body)
}

export function readQuery<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  return schema.parse(c.req.query())
}

const uuid = z.uuid()

/** Returns a route parameter that must be a UUID (400 otherwise, so malformed ids never reach the database). */
export function uuidParam(c: Context<AppEnv>, name: string): string {
  const value = c.req.param(name)
  if (!value || !uuid.safeParse(value).success) throw badRequest(`Invalid ${name}`)
  return value
}

/** Guards any mutation: rejects the read-only preview and callers below `minRole`. */
export function requireWrite(scope: Scope, minRole: WorkspaceRole = 'member'): asserts scope is Scope & { userId: string } {
  if (scope.readOnly || scope.mode !== 'user' || !scope.userId) throw readOnly()
  if (ROLE_RANK[scope.role] < ROLE_RANK[minRole]) {
    throw forbidden(`This action requires the ${minRole} role or higher`)
  }
}

export function rangeFor(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize
  return [from, from + pageSize - 1]
}
