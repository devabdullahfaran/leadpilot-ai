import { useState, type FormEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { safeNextPath, useAuth } from '@/auth/auth-context'
import { FormField } from '@/components/app/form-field'
import { FullPageLoader } from '@/components/app/full-page-loader'
import { AuthLayout, AuthUnavailable } from '@/components/layout/auth-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { authErrorMessage, fieldErrors, loginSchema } from './schemas'

type Field = 'email' | 'password'

export function LoginPage() {
  const { configured, session, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const expired = params.get('expired') === '1'

  const [values, setValues] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <FullPageLoader />
  if (session) return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const parsed = loginSchema.safeParse(values)
    if (!parsed.success) return setErrors(fieldErrors<Field>(parsed.error))
    setErrors({})
    if (!supabase) return
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword(parsed.data)
    setSubmitting(false)
    if (error) return setFormError(authErrorMessage(error.message))
    navigate(next, { replace: true })
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to your workspace."
      footer={
        configured ? (
          <>
            Don’t have an account?{' '}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </>
        ) : null
      }
    >
      {!configured ? (
        <AuthUnavailable />
      ) : (
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {expired ? (
            <Alert>
              <AlertDescription>Your session expired. Sign in again to continue.</AlertDescription>
            </Alert>
          ) : null}
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FormField label="Email" error={errors.email}>
            <Input
              type="email"
              autoComplete="email"
              autoFocus
              value={values.email}
              onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            />
          </FormField>
          <FormField
            label="Password"
            error={errors.password}
            labelAside={
              <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            }
          >
            <Input
              type="password"
              autoComplete="current-password"
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Sign in
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
