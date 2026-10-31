import { PostgrestClient } from '@supabase/postgrest-js'
import { type AppConfig, restBaseUrl } from '../env'

export type Db = PostgrestClient

const looksLikeJwt = (key: string) => key.split('.').length === 3 && key.startsWith('eyJ')

/**
 * Client that acts as the signed-in user: PostgREST evaluates RLS with the user's JWT.
 * The publishable key only identifies the project to the Supabase gateway.
 */
export function createUserDb(config: AppConfig, accessToken: string): Db {
  return new PostgrestClient(restBaseUrl(config), {
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
  })
}

/**
 * Service-role client (bypasses RLS). New `sb_secret_` keys go in the `apikey` header only; legacy
 * service_role JWT keys are also sent as a Bearer token.
 */
export function createServiceDb(config: AppConfig): Db {
  const headers: Record<string, string> = { apikey: config.secretKey }
  if (looksLikeJwt(config.secretKey)) headers.Authorization = `Bearer ${config.secretKey}`
  return new PostgrestClient(restBaseUrl(config), { headers })
}
