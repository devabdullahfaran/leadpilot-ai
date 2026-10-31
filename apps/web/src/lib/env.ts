// Browser-visible configuration. Only VITE_* variables are bundled; none of them are secrets.

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

const apiUrl = clean(import.meta.env.VITE_API_URL) || 'http://localhost:8787'
const supabaseUrl = clean(import.meta.env.VITE_SUPABASE_URL)
const supabasePublishableKey = clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

export const env = {
  /** API Worker origin without a trailing slash, e.g. http://localhost:8787 */
  apiUrl: apiUrl.replace(/\/+$/, ''),
  supabaseUrl,
  supabasePublishableKey,
  /** Sign-in is available only when both Supabase values are present. */
  authConfigured: Boolean(supabaseUrl && supabasePublishableKey),
} as const
