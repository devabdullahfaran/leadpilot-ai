import { useState, type FormEvent } from 'react'
import { LoaderCircle, MailCheck } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAuth } from '@/auth/auth-context'
import { FormField } from '@/components/app/form-field'
import { FullPageLoader } from '@/components/app/full-page-loader'
import { AuthLayout, AuthUnavailable } from '@/components/layout/auth-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { authErrorMessage, fieldErrors, registerSchema } from './schemas'

type Field = 'fullName' | 'email' | 'password' | 'confirmPassword'

export function RegisterPage() {
  const { configured, session, loading } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState({ fullName: '', email: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null)

  if (loading) return <FullPageLoader />
  if (session && !confirmationSentTo) return <Navigate to="/dashboard" replace />

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const parsed = registerSchema.safeParse(values)
    if (!parsed.success) return setErrors(fieldErrors<Field>(parsed.error))
    setErrors({})
    if (!supabase) return
    setSubmitting(true)
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })
    setSubmitting(false)
    if (error) return setFormError(authErrorMessage(error.message))
    // With email confirmation enabled Supabase returns no session until the link is clicked.
    if (data.session) navigate('/dashboard', { replace: true })
    else setConfirmationSentTo(parsed.data.email)
  }

  if (confirmationSentTo) {
    return (
      <AuthLayout title="Check your email">
        <div className="grid gap-4 text-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MailCheck className="size-5" aria-hidden="true" />
            </span>
            <p className="text-muted-foreground">
              We sent a confirmation link to <span className="font-medium text-foreground">{confirmationSentTo}</span>.
              Open it to activate your account, then sign in.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Nothing after a few minutes? Check your spam folder, or try again later — confirmation emails are rate
            limited.
          </p>
          <Button variant="outline" render={<Link to="/login" />} nativeButton={false}>
            Back to sign in
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Start qualifying leads in your own workspace."
      footer={
        configured ? (
          <>
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        ) : null
      }
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
          <FormField label="Full name" error={errors.fullName}>
            <Input autoComplete="name" autoFocus value={values.fullName} onChange={set('fullName')} />
          </FormField>
          <FormField label="Work email" error={errors.email}>
            <Input type="email" autoComplete="email" value={values.email} onChange={set('email')} />
          </FormField>
          <FormField label="Password" error={errors.password} description="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={values.password} onChange={set('password')} />
          </FormField>
          <FormField label="Confirm password" error={errors.confirmPassword}>
            <Input
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={set('confirmPassword')}
            />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Create account
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
