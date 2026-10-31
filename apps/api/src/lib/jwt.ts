import { createRemoteJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose'
import type { AppConfig } from '../env'
import { unauthorized } from './errors'
import type { AuthUser } from '../types'

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwksFor(supabaseUrl: string) {
  const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`
  let jwks = jwksByUrl.get(url)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30 * 1000 })
    jwksByUrl.set(url, jwks)
  }
  return jwks
}

/**
 * Verifies a Supabase Auth access token.
 * - Asymmetric signing keys (ES256/RS256): verified against the project's JWKS endpoint.
 * - Legacy HS256 projects (and local tests): verified with SUPABASE_JWT_SECRET when configured.
 * Issuer and audience are always checked.
 */
export async function verifyAccessToken(token: string, config: AppConfig): Promise<AuthUser> {
  const options = { issuer: `${config.supabaseUrl}/auth/v1`, audience: 'authenticated' }
  let payload: JWTPayload
  try {
    const { alg } = decodeProtectedHeader(token)
    if (alg === 'HS256') {
      if (!config.jwtSecret) throw unauthorized('Invalid or expired session')
      ;({ payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret), {
        ...options,
        algorithms: ['HS256'],
      }))
    } else {
      ;({ payload } = await jwtVerify(token, jwksFor(config.supabaseUrl), {
        ...options,
        algorithms: ['ES256', 'RS256'],
      }))
    }
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw unauthorized('Session expired. Please sign in again.')
    throw unauthorized('Invalid or expired session')
  }
  if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') {
    throw unauthorized('Invalid or expired session')
  }
  return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : null }
}
