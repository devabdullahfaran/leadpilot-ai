// HS256 access tokens shaped like Supabase Auth's, for API integration tests against a local PostgREST.
// The secret is a fixed local-only test value, never a real project secret.
import { SignJWT } from 'jose'

export const TEST_JWT_SECRET = 'leadpilot-local-test-only-jwt-secret-0123456789'
export const TEST_SUPABASE_URL = 'http://127.0.0.1:54321'

export interface TestTokenOptions {
  sub?: string
  email?: string
  role?: 'authenticated' | 'anon' | 'service_role'
  /** Seconds until expiry; negative values produce an already-expired token. */
  expiresIn?: number
  secret?: string
  supabaseUrl?: string
  audience?: string
}

export async function signTestJwt(opts: TestTokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const role = opts.role ?? 'authenticated'
  const claims: Record<string, unknown> = { role }
  if (opts.email) claims.email = opts.email
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(`${(opts.supabaseUrl ?? TEST_SUPABASE_URL).replace(/\/$/, '')}/auth/v1`)
    .setAudience(opts.audience ?? 'authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresIn ?? 3600))
  if (opts.sub) jwt.setSubject(opts.sub)
  return jwt.sign(new TextEncoder().encode(opts.secret ?? TEST_JWT_SECRET))
}
