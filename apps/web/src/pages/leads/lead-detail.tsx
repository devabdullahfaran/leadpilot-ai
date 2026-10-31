import { useState } from 'react'
import { ArrowLeft, ExternalLink, LoaderCircle, MoreHorizontal, Pencil, SearchX, Sparkles, Trash2, UserPen, Workflow } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { LEAD_STATUSES, type Lead, type LeadStatus } from '@leadpilot/shared'
import {
  useAiSettings,
  useDeleteLead,
  useExecutions,
  useLead,
  useLeadQualifications,
  useMembers,
  useUpdateLead,
} from '@/api'
import { useAppLink } from '@/app/data-mode'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ExecutionStatusBadge,
  LeadStatusBadge,
  PageHeader,
  PriorityBadge,
  QualificationStatusBadge,
  ReadOnlyGuard,
  RelativeTime,
  SampleBadge,
  useMutationGuard,
  usePageTitle,
} from '@/components/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage, isApiClientError } from '@/lib/api-client'
import { formatDateTime, formatDuration, formatEnumLabel, formatNumber } from '@/lib/format'
import { ActivityTimeline } from './activity-timeline'
import { LeadFormDialog } from './lead-form-dialog'
import { enumOptions, ownerOptions } from './lib'
import { OverrideDialog } from './override-dialog'
import { QualificationCard, QualificationHistory } from './qualification-card'
import { SimpleSelect } from './simple-select'
import { useRunQualification } from './use-run-qualification'

const STATUS_OPTIONS = enumOptions(LEAD_STATUSES)
const NO_OWNER = '__none'

export function LeadDetailPage() {
  const { leadId } = useParams()
  const link = useAppLink()
  const lead = useLead(leadId)
  usePageTitle(lead.data?.name)

  if (lead.isPending) return <DetailSkeleton />
  if (lead.error) {
    if (isApiClientError(lead.error) && lead.error.code === 'not_found') {
      return (
        <EmptyState
          icon={SearchX}
          title="Lead not found"
          description="It may have been deleted, or it belongs to a different workspace."
          action={
            <Button variant="outline" render={<Link to={link('/leads')} />}>
              <ArrowLeft aria-hidden="true" />
              Back to leads
            </Button>
          }
        />
      )
    }
    return <ErrorState error={lead.error} onRetry={() => void lead.refetch()} retrying={lead.isFetching} />
  }
  return <LeadDetail lead={lead.data} />
}

function LeadDetail({ lead }: { lead: Lead }) {
  const link = useAppLink()
  const navigate = useNavigate()
  const settings = useAiSettings()
  const qualifications = useLeadQualifications(lead.id)
  const deleteLead = useDeleteLead()
  const qualification = useRunQualification()
  const [editing, setEditing] = useState(false)
  const [overriding, setOverriding] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function confirmDelete() {
    try {
      await deleteLead.mutateAsync(lead.id)
      toast.success(`Lead “${lead.name}” deleted`)
      navigate(link('/leads'))
    } catch (error) {
      toast.error(errorMessage(error))
      throw error
    }
  }

  const runAi = () => void qualification.run(lead.id, lead.name)
  const subtitle = [lead.jobTitle, lead.company].filter(Boolean).join(' · ')

  return (
    <div className="space-y-6">
      <PageHeader
        title={lead.name}
        description={subtitle || undefined}
        meta={
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={lead.priority} />
            <QualificationStatusBadge status={qualification.isPending ? 'processing' : lead.qualificationStatus} />
            <LeadStatusBadge status={lead.status} />
            {lead.isSample ? <SampleBadge /> : null}
          </div>
        }
        actions={
          <>
            <ReadOnlyGuard action="run AI qualification" minRole="member">
              <Button onClick={runAi} disabled={qualification.isPending}>
                {qualification.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {qualification.isPending ? 'Qualifying…' : 'Run AI qualification'}
              </Button>
            </ReadOnlyGuard>
            <ReadOnlyGuard action="override qualification" minRole="member">
              <Button variant="outline" onClick={() => setOverriding(true)}>
                <UserPen aria-hidden="true" />
                Override
              </Button>
            </ReadOnlyGuard>
            <ReadOnlyGuard action="edit leads" minRole="member">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            </ReadOnlyGuard>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <ReadOnlyGuard action="delete leads" minRole="admin" className="w-full">
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)} className="w-full">
                    <Trash2 aria-hidden="true" />
                    Delete lead
                  </DropdownMenuItem>
                </ReadOnlyGuard>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Inquiry message</CardTitle>
              <CardDescription>
                Submitted via {formatEnumLabel(lead.source).toLowerCase()} · <RelativeTime value={lead.createdAt} />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm break-words whitespace-pre-line">{lead.message}</p>
            </CardContent>
          </Card>
          <QualificationCard
            lead={lead}
            latest={qualifications.data?.[0]}
            historyLoading={qualifications.isPending}
            settings={settings.data}
            running={qualification.isPending}
            onRun={runAi}
          />
          <QualificationHistory
            items={qualifications.data}
            isPending={qualifications.isPending}
            error={qualifications.error}
            onRetry={() => void qualifications.refetch()}
          />
          <WorkflowActivity leadId={lead.id} />
        </div>
        <div className="min-w-0 space-y-6">
          <ContactCard lead={lead} />
          <AssignmentCard lead={lead} />
          <ActivityTimeline leadId={lead.id} />
        </div>
      </div>

      <LeadFormDialog open={editing} onOpenChange={setEditing} lead={lead} />
      <OverrideDialog
        open={overriding}
        onOpenChange={setOverriding}
        lead={lead}
        thresholds={settings.data?.thresholds}
        categories={settings.data?.categories}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete lead?"
        description={`“${lead.name}” and its activity, qualification history and notes will be permanently removed.`}
        confirmLabel="Delete lead"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function ContactCard({ lead }: { lead: Lead }) {
  const website = lead.website ? (/^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`) : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
          <Row label="Email">
            <a href={`mailto:${lead.email}`} className="break-all text-primary hover:underline">{lead.email}</a>
          </Row>
          <Row label="Phone">{lead.phone ? <a href={`tel:${lead.phone}`} className="text-primary hover:underline">{lead.phone}</a> : '—'}</Row>
          <Row label="Website">
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                {lead.website}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Company">{lead.company}</Row>
          <Row label="Job title">{lead.jobTitle ?? '—'}</Row>
          <Row label="Source">{formatEnumLabel(lead.source)}</Row>
          <Row label="Submissions">
            <span className="tabular-nums">{formatNumber(lead.submissionCount)}</span>
          </Row>
          <Row label="Created">{formatDateTime(lead.createdAt)}</Row>
          <Row label="Updated">{formatDateTime(lead.updatedAt)}</Row>
        </dl>
      </CardContent>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function AssignmentCard({ lead }: { lead: Lead }) {
  const members = useMembers()
  const update = useUpdateLead()
  const guard = useMutationGuard({ action: 'edit leads', minRole: 'member' })
  const owners = [{ value: NO_OWNER, label: 'Unassigned' }, ...ownerOptions(members.data, lead.owner)]

  async function save(data: { status?: LeadStatus; ownerId?: string | null }, message: string) {
    try {
      await update.mutateAsync({ id: lead.id, data })
      toast.success(message)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <label className="grid gap-1.5">
          <span className="text-muted-foreground">Status</span>
          <ReadOnlyGuard action="edit leads" minRole="member" className="w-full">
            <SimpleSelect
              aria-label="Lead status"
              value={lead.status}
              options={STATUS_OPTIONS}
              disabled={update.isPending}
              onValueChange={(v) => v !== lead.status && void save({ status: v as LeadStatus }, `Status set to ${formatEnumLabel(v)}`)}
            />
          </ReadOnlyGuard>
        </label>
        <label className="grid gap-1.5">
          <span className="text-muted-foreground">Owner</span>
          <ReadOnlyGuard action="edit leads" minRole="member" className="w-full">
            <SimpleSelect
              aria-label="Lead owner"
              value={lead.owner?.id ?? NO_OWNER}
              options={owners}
              disabled={update.isPending || (guard.allowed && members.isPending)}
              onValueChange={(v) => {
                const ownerId = v === NO_OWNER ? null : v
                if (ownerId === (lead.owner?.id ?? null)) return
                const label = owners.find((o) => o.value === v)?.label ?? 'owner'
                void save({ ownerId }, ownerId ? `Assigned to ${label}` : 'Owner removed')
              }}
            />
          </ReadOnlyGuard>
        </label>
      </CardContent>
    </Card>
  )
}

function WorkflowActivity({ leadId }: { leadId: string }) {
  const link = useAppLink()
  const executions = useExecutions({ leadId, pageSize: 5 })
  const items = executions.data?.data ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow activity</CardTitle>
        <CardDescription>Recent automation runs for this lead</CardDescription>
      </CardHeader>
      <CardContent>
        {executions.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : executions.error ? (
          <ErrorState error={executions.error} size="compact" onRetry={() => void executions.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workflow runs yet. Running AI qualification records an execution here.</p>
        ) : (
          <ul className="divide-y text-sm">
            {items.map((ex) => (
              <li key={ex.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <ExecutionStatusBadge status={ex.status} />
                <span className="font-medium">{formatEnumLabel(ex.workflowKey)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {ex.steps.length} {ex.steps.length === 1 ? 'step' : 'steps'} · {ex.durationMs === null ? '—' : formatDuration(ex.durationMs)}
                </span>
                {ex.isSample ? <SampleBadge /> : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  <RelativeTime value={ex.startedAt} />
                </span>
                {ex.errorMessage ? <p className="w-full text-xs text-danger">{ex.errorMessage}</p> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 border-t pt-3">
          <Button variant="link" size="sm" className="h-auto px-0" render={<Link to={link('/workflows')} />}>
            <Workflow aria-hidden="true" />
            View all in Workflows
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading lead">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
