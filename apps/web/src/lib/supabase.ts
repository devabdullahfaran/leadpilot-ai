import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

/** Supabase is used for Auth only. `null` when this deployment has no Supabase configuration. */
export const supabase: SupabaseClient | null = env.authConfigured
  ? createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
