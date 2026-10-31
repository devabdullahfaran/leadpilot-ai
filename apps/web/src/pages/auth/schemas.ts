import { z } from 'zod'

const email = z.string().trim().min(1, 'Enter your email address').pipe(z.email('Enter a valid email address'))
const newPassword = z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
})

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your name').max(120, 'Use at most 120 characters'),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })

/** First error message per top-level field. */
export function fieldErrors<T extends string>(error: z.ZodError): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '') as T
    if (key && !(key in out)) out[key] = issue.message
  }
  return out
}

/** Friendlier copy for the Supabase Auth errors users actually hit. */
export function authErrorMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email or password is incorrect.'
  if (m.includes('email not confirmed')) return 'Confirm your email address first — check your inbox for the link.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Could not reach the sign-in service. Check your connection.'
  return message
}
