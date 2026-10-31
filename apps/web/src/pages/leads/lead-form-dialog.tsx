import { useState, type FormEvent } from 'react'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  leadCreateSchema,
  type Lead,
  type LeadCreate,
} from '@leadpilot/shared'
import { useCreateLead, useDuplicateCheck, useMembers, useUpdateLead, type LeadUpdateInput } from '@/api'
import { useAppLink } from '@/app/data-mode'
import { FormField, useMutationGuard } from '@/components/app'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage, isApiClientError } from '@/lib/api-client'
import { formatEnumLabel } from '@/lib/format'
import { enumOptions, ownerOptions, useDebouncedValue } from './lib'
import { SimpleSelect } from './simple-select'
import { useRunQualification } from './use-run-qualification'

type Values = {
  name: string
  email: string
  phone: string
  company: string
  jobTitle: string
  website: string
  source: string
  message: string
  status: string
  ownerId: string
}
type Field = keyof Values

const NO_OWNER = '__none'
const SOURCE_OPTIONS = enumOptions(LEAD_SOURCES)
const STATUS_OPTIONS = enumOptions(LEAD_STATUSES)

function initialValues(lead?: Lead | null): Values {
  return {
    name: lead?.name ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    company: lead?.company ?? '',
    jobTitle: lead?.jobTitle ?? '',
    website: lead?.website ?? '',
    source: lead?.source ?? 'manual',
    message: lead?.message ?? '',
    status: lead?.status ?? 'new',
    ownerId: lead?.owner?.id ?? NO_OWNER,
  }
}

function toInput(values: Values) {
  return { ...values, ownerId: values.ownerId === NO_OWNER ? null : values.ownerId }
}

/** Fields whose parsed value differs from the lead (PATCH sends only these). */
function changedFields(lead: Lead, data: LeadCreate): LeadUpdateInput {
  const current: Record<string, unknown> = {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    jobTitle: lead.jobTitle,
    website: lead.website,
    source: lead.source,
    message: lead.message,
    status: lead.status,
    ownerId: lead.owner?.id ?? null,
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if ((value ?? null) !== (current[key] ?? null)) out[key] = value ?? null
  }
  return out as LeadUpdateInput
}

interface LeadFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → edit mode. */
  lead?: Lead | null
}

export function LeadFormDialog({ open, onOpenChange, lead }: LeadFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        {open ? <LeadForm lead={lead} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function LeadForm({ lead, onDone }: { lead?: Lead | null; onDone: () => void }) {
  const isEdit = Boolean(lead)
  const link = useAppLink()
  const navigate = useNavigate()
  const guard = useMutationGuard({ action: isEdit ? 'edit leads' : 'create leads', minRole: 'member' })
  const members = useMembers()
  const createLead = useCreateLead()
  const updateLead = useUpdateLead()
  const qualification = useRunQualification()

  const [values, setValues] = useState<Values>(() => initialValues(lead))
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const [runAi, setRunAi] = useState(true)
  const pending = createLead.isPending || updateLead.isPending

  const dupParams = useDebouncedValue(
    { email: values.email.trim(), phone: values.phone.trim(), company: values.company.trim(), excludeId: lead?.id },
    400,
  )
  const duplicates = useDuplicateCheck(dupParams)
  const matches = duplicates.data ?? []

  const set = (field: Field) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setDuplicateId(null)
    const parsed = leadCreateSchema.safeParse(toInput(values))
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    try {
      if (lead) {
        const data = changedFields(lead, parsed.data)
        if (Object.keys(data).length === 0) {
          toast.info('No changes to save')
          onDone()
          return
        }
        await updateLead.mutateAsync({ id: lead.id, data })
        toast.success('Lead updated')
        onDone()
      } else {
        const created = await createLead.mutateAsync(parsed.data)
        toast.success(`Lead “${created.name}” created`)
        onDone()
        navigate(link(`/leads/${created.id}`))
        // The lead is already saved; a failed AI run is reported separately and leaves it intact.
        if (runAi) void qualification.run(created.id, created.name)
      }
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'duplicate_lead') {
          const id = (error.details as { existingLeadId?: unknown } | null)?.existingLeadId
          setDuplicateId(typeof id === 'string' ? id : null)
          setErrors((e) => ({ ...e, email: 'A lead with this email already exists in this workspace.' }))
          return
        }
        const fieldErrors = error.fieldErrors
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors as Partial<Record<Field, string>>)
      }
      setFormError(errorMessage(error))
      toast.error(errorMessage(error))
    }
  }

  const owners = [{ value: NO_OWNER, label: 'Unassigned' }, ...ownerOptions(members.data, lead?.owner ?? null)]

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit lead' : 'New lead'}</DialogTitle>
        <DialogDescription>
          {isEdit ? 'Update contact details and sales status. AI fields change only through qualification.' : 'Add a lead manually. Required fields are marked *.'}
        </DialogDescription>
      </DialogHeader>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name *" error={errors.name}>
          <Input autoFocus value={values.name} onChange={(e) => set('name')(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Email *" error={errors.email}>
          <Input type="email" value={values.email} onChange={(e) => set('email')(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Phone" error={errors.phone}>
          <Input type="tel" value={values.phone} onChange={(e) => set('phone')(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Company *" error={errors.company}>
          <Input value={values.company} onChange={(e) => set('company')(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Job title" error={errors.jobTitle}>
          <Input value={values.jobTitle} onChange={(e) => set('jobTitle')(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Website" error={errors.website}>
          <Input value={values.website} placeholder="example.com" onChange={(e) => set('website')(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Source" error={errors.source}>
          <SimpleSelect value={values.source} onValueChange={set('source')} options={SOURCE_OPTIONS} />
        </FormField>
        <FormField label="Status" error={errors.status}>
          <SimpleSelect value={values.status} onValueChange={set('status')} options={STATUS_OPTIONS} />
        </FormField>
        <FormField label="Owner" error={errors.ownerId} className="sm:col-span-2">
          <SimpleSelect value={values.ownerId} onValueChange={set('ownerId')} options={owners} />
        </FormField>
        <FormField label="Inquiry message *" error={errors.message} className="sm:col-span-2">
          <Textarea rows={4} value={values.message} onChange={(e) => set('message')(e.target.value)} />
        </FormField>
      </div>

      {duplicateId ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Duplicate email</AlertTitle>
          <AlertDescription>
            This email already belongs to a lead.{' '}
            <Link to={link(`/leads/${duplicateId}`)} onClick={onDone} className="font-medium underline">
              Open existing lead
            </Link>
          </AlertDescription>
        </Alert>
      ) : matches.length > 0 ? (
        <Alert aria-live="polite">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Possible duplicates</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link to={link(`/leads/${m.id}`)} onClick={onDone} className="font-medium text-primary hover:underline">
                    {m.name}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    · {m.company} · matches {m.matchedOn.map((f) => formatEnumLabel(f).toLowerCase()).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {!isEdit ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={runAi} onCheckedChange={(checked) => setRunAi(checked === true)} className="mt-0.5" />
          <span>
            Run AI qualification after saving
            <span className="block text-xs text-muted-foreground">Uses one AI call from the daily quota. The lead is saved even if AI fails.</span>
          </span>
        </label>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !guard.allowed} title={guard.reason ?? undefined}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          {isEdit ? 'Save changes' : 'Create lead'}
        </Button>
      </DialogFooter>
    </form>
  )
}
