import { useState, type FormEvent } from 'react'
import { LoaderCircle, MailCheck } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/auth-context'
import { FormField } from '@/components/app/form-field'
import { AuthLayout, AuthUnavailable } from '@/components/layout/auth-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { authErrorMessage, fieldErrors, forgotPasswordSchema } from './schemas'

export function ForgotPasswordPage() {
  const { configured } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const parsed = forgotPasswordSchema.safeParse({ email })
    if (!parsed.success) return setError(fieldErrors<'email'>(parsed.error).email)
    setError(undefined)
    if (!supabase) return
    setSubmitting(true)
    const { error: authError } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSubmitting(false)
    if (authError) return setFormError(authErrorMessage(authError.message))
    setSentTo(parsed.data.email)
  }

  const footer = (
    <Link to="/login" className="font-medium text-primary hover:underline">
      Back to sign in
    </Link>
  )

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={footer}>
        <div className="flex items-start gap-3 text-sm">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailCheck className="size-5" aria-hidden="true" />
          </span>
          <p className="text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, a password reset link
            is on its way. The link opens a page where you can choose a new password.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your account email and we’ll send you a reset link."
      footer={footer}
    >
      {!configured ? (
        <AuthUnavailable />
      ) : (
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FormField label="Email" error={error}>
            <Input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
