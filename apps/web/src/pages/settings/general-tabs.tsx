import { useState, type FormEvent } from 'react'
import { Database, Users } from 'lucide-react'
import { toast } from 'sonner'
import { profileUpdateSchema, workspaceUpdateSchema } from '@leadpilot/shared'
import { useClearSampleData, useDashboardSummary, useLoadSampleData, useMembers, useSession, useUpdateProfile, useUpdateWorkspace } from '@/api'
import { useDataMode } from '@/app/data-mode'
import { useWorkspace } from '@/app/workspace'
import { ConfirmDialog, EmptyState, ErrorState, FormField, ReadOnlyGuard, RoleBadge, useMutationGuard } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api-client'
import { Section } from './section'

function ReadOnlyNote({ text }: { text: string }) {
  return <p className="rounded-lg border bg-muted/40 p-3 text-[13px] text-muted-foreground">{text}</p>
}

export function WorkspaceTab() {
  const { workspace, role } = useWorkspace()
  const guard = useMutationGuard({ action: 'rename the workspace', minRole: 'admin' })
  const update = useUpdateWorkspace()
  const [name, setName] = useState(workspace?.name ?? '')
  const [error, setError] = useState<string | null>(null)

  if (!workspace) {
    return (
      <Section title="Workspace">
        <ReadOnlyNote text="The preview uses a shared demo workspace. Sign in to manage your own workspace." />
      </Section>
    )
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = workspaceUpdateSchema.safeParse({ name })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid name')
      return
    }
    setError(null)
    update.mutate(parsed.data, {
      onSuccess: () => toast.success('Workspace renamed'),
      onError: (err) => toast.error(errorMessage(err)),
    })
  }

  return (
    <Section title="Workspace" description="Basic details of the active workspace.">
      <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
        <FormField label="Name" error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!guard.allowed || update.isPending} maxLength={80} />
        </FormField>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="font-mono">{workspace.slug}</dd>
          <dt className="text-muted-foreground">Your role</dt>
          <dd>{role ? <RoleBadge role={role} /> : '—'}</dd>
        </dl>
        <ReadOnlyGuard action="rename the workspace" minRole="admin">
          <Button type="submit" disabled={update.isPending || name.trim() === workspace.name}>
            Save
          </Button>
        </ReadOnlyGuard>
      </form>
    </Section>
  )
}

export function ProfileTab() {
  const { readOnly } = useDataMode()
  const session = useSession()
  if (readOnly) {
    return (
      <Section title="Profile">
        <ReadOnlyNote text="Sign in to edit your profile." />
      </Section>
    )
  }
  if (session.isPending) return <Skeleton className="h-48 w-full" aria-label="Loading profile" />
  if (session.isError) return <ErrorState error={session.error} onRetry={() => void session.refetch()} retrying={session.isFetching} />
  return <ProfileForm key={session.data.user.id} fullName={session.data.user.fullName ?? ''} email={session.data.user.email} />
}

function ProfileForm({ fullName, email }: { fullName: string; email: string | null }) {
  const update = useUpdateProfile()
  const [name, setName] = useState(fullName)
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = profileUpdateSchema.safeParse({ fullName: name })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid name')
      return
    }
    setError(null)
    update.mutate(parsed.data, {
      onSuccess: () => toast.success('Profile updated'),
      onError: (err) => toast.error(errorMessage(err)),
    })
  }

  return (
    <Section title="Profile" description="How you appear to teammates.">
      <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
        <FormField label="Full name" error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={update.isPending} maxLength={120} autoComplete="name" />
        </FormField>
        <FormField label="Email" description="Your sign-in email cannot be changed here.">
          <Input value={email ?? ''} readOnly disabled />
        </FormField>
        <ReadOnlyGuard action="edit your profile">
          <Button type="submit" disabled={update.isPending || name.trim() === fullName}>
            Save
          </Button>
        </ReadOnlyGuard>
      </form>
    </Section>
  )
}

export function MembersTab() {
  const members = useMembers()
  return (
    <Section title="Members" description="Inviting members is not available in this version.">
      {members.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading members">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} retrying={members.isFetching} />
      ) : members.data.length === 0 ? (
        <EmptyState icon={Users} title="No members to show" description="The preview does not list members. Sign in to see your workspace team." />
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.fullName ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{m.email ?? '—'}</TableCell>
                  <TableCell>
                    <RoleBadge role={m.role} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  )
}

export function SampleDataTab() {
  const summary = useDashboardSummary()
  const load = useLoadSampleData()
  const clear = useClearSampleData()
  const [confirmClear, setConfirmClear] = useState(false)
  const busy = load.isPending || clear.isPending
  const count = summary.data?.sampleRecordCount

  return (
    <Section
      title="Sample data"
      description="Synthetic leads, qualifications and workflow runs for exploring the product. Every sample record is flagged is_sample and shows a Sample badge; your real data is never touched."
    >
      <div className="flex items-center gap-2 text-[13px]">
        <Database className="size-4 text-muted-foreground" aria-hidden="true" />
        {summary.isPending ? (
          <Skeleton className="h-4 w-40" />
        ) : summary.isError ? (
          <span className="text-muted-foreground">Sample record count unavailable.</span>
        ) : (
          <span>
            <span className="font-medium tabular-nums">{count}</span> sample records in this workspace
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <ReadOnlyGuard action="load sample data" minRole="admin">
          <Button
            disabled={busy}
            onClick={() =>
              load.mutate(undefined, {
                onSuccess: (r) => toast.success(`Loaded ${r.leads} sample leads`),
                onError: (err) => toast.error(errorMessage(err)),
              })
            }
          >
            Load sample data
          </Button>
        </ReadOnlyGuard>
        <ReadOnlyGuard action="remove sample data" minRole="admin">
          <Button variant="outline" disabled={busy || count === 0} onClick={() => setConfirmClear(true)}>
            Remove sample data
          </Button>
        </ReadOnlyGuard>
      </div>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Remove all sample data?"
        description="Every record flagged as sample is deleted. Real leads are not affected."
        confirmLabel="Remove"
        destructive
        onConfirm={() =>
          clear.mutateAsync().then(
            (r) => {
              toast.success(`Removed ${r.leads} sample leads`)
            },
            (err: unknown) => {
              toast.error(errorMessage(err))
              throw err
            },
          )
        }
      />
    </Section>
  )
}
