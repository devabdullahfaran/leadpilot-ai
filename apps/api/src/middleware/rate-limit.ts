import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ApiError } from '../lib/errors'
import type { AppEnv } from '../types'

export type LimitKind = 'api' | 'ai' | 'intake'

/** Fallback limits (requests per 60 s) used when the Workers Rate Limiting binding is not configured. */
const FALLBACK_LIMITS: Record<LimitKind, number> = { api: 120, ai: 6, intake: 10 }
const WINDOW_MS = 60_000
const MAX_TRACKED_KEYS = 5_000

const windows = new Map<string, { start: number; count: number }>()

/**
 * Best-effort fixed-window limiter, local to one Worker isolate. It slows down abuse from a single
 * client but is not a global guarantee; the authoritative cost control for AI is the database quota
 * (reserve_ai_call).
 */
function memoryLimit(key: string, limit: number, now: number): boolean {
  const w = windows.get(key)
  if (!w || now - w.start >= WINDOW_MS) {
    if (windows.size >= MAX_TRACKED_KEYS) windows.clear()
    windows.set(key, { start: now, count: 1 })
    return true
  }
  w.count += 1
  return w.count <= limit
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown'
}

export async function checkRateLimit(c: Context<AppEnv>, kind: LimitKind, key: string): Promise<void> {
  const binding =
    kind === 'api' ? c.env.API_RATE_LIMITER : kind === 'ai' ? c.env.AI_RATE_LIMITER : c.env.INTAKE_RATE_LIMITER
  let allowed: boolean
  if (binding) {
    try {
      allowed = (await binding.limit({ key: `${kind}:${key}` })).success
    } catch {
      allowed = memoryLimit(`${kind}:${key}`, FALLBACK_LIMITS[kind], Date.now())
    }
  } else {
    allowed = memoryLimit(`${kind}:${key}`, FALLBACK_LIMITS[kind], Date.now())
  }
  if (!allowed) {
    c.header('Retry-After', '60')
    throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a minute and try again.')
  }
}

/** Limits by authenticated user when available, otherwise by client IP. */
export const rateLimit = (kind: LimitKind) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user')
    await checkRateLimit(c, kind, user ? `u:${user.id}` : `ip:${clientIp(c)}`)
    await next()
  })

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear()
}
