import { useState, type FormEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/auth/auth-context'
import { FormField } from '@/components/app/form-field'
import { FullPageLoader } from '@/components/app/full-page-loader'
import { AuthLayout, AuthUnavailable } from '@/components/layout/auth-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { authErrorMessage, fieldErrors, resetPasswordSchema } from './schemas'

type Field = 'password' | 'confirmPassword'

export function ResetPasswordPage() {
  const { configured, session, loading } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState({ password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <FullPageLoader />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const parsed = resetPasswordSchema.safeParse(values)
    if (!parsed.success) return setErrors(fieldErrors<Field>(parsed.error))
    setErrors({})
    if (!supabase) return
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
    setSubmitting(false)
    if (error) return setFormError(authErrorMessage(error.message))
    toast.success('Password updated')
    navigate('/dashboard', { replace: true })
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="Set the password you’ll use to sign in from now on."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {!configured ? (
        <AuthUnavailable />
      ) : !session ? (
        <Alert>
          <AlertTitle>This reset link is invalid or has expired</AlertTitle>
          <AlertDescription>
            Reset links work once and expire after a short time.{' '}
            <Link to="/forgot-password">Request a new link</Link>.
          </AlertDescription>
        </Alert>
      ) : (
        <form noValidate onSubmit={onSubmit} className="grid gap-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FormField label="New password" error={errors.password} description="At least 8 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            />
          </FormField>
          <FormField label="Confirm new password" error={errors.confirmPassword}>
            <Input
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={(e) => setValues((v) => ({ ...v, confirmPassword: e.target.value }))}
            />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
