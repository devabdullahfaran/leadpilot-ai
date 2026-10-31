import { z } from 'zod'

/** Worker bindings: wrangler `vars`, secrets, and optional rate-limit bindings. */
export interface Bindings {
  ENVIRONMENT?: string
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string
  SUPABASE_JWT_SECRET?: string
  /** Test-only override pointing at a bare PostgREST server (no /rest/v1 prefix). */
  SUPABASE_REST_URL?: string
  ALLOWED_ORIGINS?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  GEMINI_TIMEOUT_MS?: string
  AI_ENABLED?: string
  AI_DAILY_LIMIT_GLOBAL?: string
  AI_DAILY_LIMIT_PER_WORKSPACE?: string
  ENCRYPTION_KEY?: string
  API_RATE_LIMITER?: RateLimit
  AI_RATE_LIMITER?: RateLimit
  INTAKE_RATE_LIMITER?: RateLimit
}

const boolString = z
  .string()
  .optional()
  .transform((v) => (v ?? 'true').trim().toLowerCase() !== 'false')

const configSchema = z.object({
  environment: z.string().default('production'),
  supabaseUrl: z.url().transform((u) => u.replace(/\/$/, '')),
  restUrl: z.url().optional(),
  publishableKey: z.string().min(10),
  secretKey: z.string().min(10),
  jwtSecret: z.string().min(16).optional(),
  allowedOrigins: z.array(z.string()).default([]),
  gemini: z.object({
    apiKey: z.string().min(10).optional(),
    model: z.string().min(3).default('gemini-3.5-flash-lite'),
    timeoutMs: z.coerce.number().int().min(2000).max(60000).default(20000),
  }),
  ai: z.object({
    enabled: boolString,
    dailyLimitGlobal: z.coerce.number().int().min(0).max(100000).default(150),
    dailyLimitPerWorkspace: z.coerce.number().int().min(0).max(10000).default(25),
  }),
  encryptionKey: z.string().min(40).optional(),
})
export type AppConfig = z.output<typeof configSchema>

const cache = new WeakMap<object, AppConfig>()

/** Parses and caches configuration per bindings object. Throws a descriptive error on misconfiguration. */
export function getConfig(env: Bindings): AppConfig {
  const hit = cache.get(env)
  if (hit) return hit
  const parsed = configSchema.safeParse({
    environment: env.ENVIRONMENT,
    supabaseUrl: env.SUPABASE_URL,
    restUrl: env.SUPABASE_REST_URL || undefined,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: env.SUPABASE_SECRET_KEY,
    jwtSecret: env.SUPABASE_JWT_SECRET || undefined,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
    gemini: {
      apiKey: env.GEMINI_API_KEY || undefined,
      model: env.GEMINI_MODEL || undefined,
      timeoutMs: env.GEMINI_TIMEOUT_MS || undefined,
    },
    ai: {
      enabled: env.AI_ENABLED,
      dailyLimitGlobal: env.AI_DAILY_LIMIT_GLOBAL || undefined,
      dailyLimitPerWorkspace: env.AI_DAILY_LIMIT_PER_WORKSPACE || undefined,
    },
    encryptionKey: env.ENCRYPTION_KEY || undefined,
  })
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid Worker configuration: ${fields}`)
  }
  cache.set(env, parsed.data)
  return parsed.data
}

/** Base URL for PostgREST: the Supabase gateway in production, a bare PostgREST server in tests. */
export function restBaseUrl(config: AppConfig): string {
  return config.restUrl ?? `${config.supabaseUrl}/rest/v1`
}
