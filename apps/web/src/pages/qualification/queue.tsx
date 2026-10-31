import { useState } from 'react'
import type { AiSettings, Lead, QualificationStatus } from '@leadpilot/shared'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CircleCheck, Play } from 'lucide-react'
import { useLeads, useQualifyLead } from '@/api'
import { useAppLink } from '@/app/data-mode'
import {
  EmptyState,
  ErrorState,
  QualificationStatusBadge,
  ReadOnlyGuard,
  RelativeTime,
  SampleBadge,
  ScoreBadge,
} from '@/components/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatNumber } from '@/lib/format'
import { aiErrorToast } from './ai-errors'

const QUEUE_TABS = [
  { value: 'pending', label: 'Pending', empty: 'No leads are waiting for AI qualification.' },
  { value: 'needs_review', label: 'Needs review', empty: 'No AI results are flagged for human review.' },
  { value: 'failed', label: 'Failed', empty: 'No leads have a failed qualification.' },
] as const satisfies readonly { value: QualificationStatus; label: string; empty: string }[]

type QueueTab = (typeof QUEUE_TABS)[number]['value']
const PAGE_SIZE = 10

export function QueueSection({ settings }: { settings?: AiSettings }) {
  const [tab, setTab] = useState<QueueTab>('pending')
  const queries = {
    pending: useLeads({ qualificationStatus: 'pending', pageSize: PAGE_SIZE }),
    needs_review: useLeads({ qualificationStatus: 'needs_review', pageSize: PAGE_SIZE }),
    failed: useLeads({ qualificationStatus: 'failed', pageSize: PAGE_SIZE }),
  }
  const active = queries[tab]
  const spec = QUEUE_TABS.find((t) => t.value === tab)!

  return (
    <Card>
      <CardHeader>
        <CardTitle>Qualification queue</CardTitle>
        <CardDescription>Leads that still need attention from the AI or a person.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as QueueTab)}>
          <TabsList className="max-w-full overflow-x-auto">
            {QUEUE_TABS.map((t) => {
              const total = queries[t.value].data?.total
              return (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                  <span className="rounded bg-muted px-1 text-[11px] tabular-nums text-muted-foreground">
                    {total === undefined ? '—' : formatNumber(total)}
                  </span>
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>

        {active.isPending ? (
          <QueueSkeleton />
        ) : active.isError ? (
          <ErrorState size="compact" error={active.error} onRetry={() => void active.refetch()} retrying={active.isFetching} />
        ) : active.data.data.length === 0 ? (
          <EmptyState size="compact" icon={CircleCheck} title="Nothing here" description={<>{spec.empty} New leads arrive via the intake form or the Leads page.</>} action={<LeadsLink />} />
        ) : (
          <>
            <QueueTable leads={active.data.data} settings={settings} />
            {active.data.total > active.data.data.length ? (
              <p className="text-xs text-muted-foreground">
                Showing the {active.data.data.length} newest of {formatNumber(active.data.total)}. <LeadsLink filter={tab} />
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LeadsLink({ filter }: { filter?: QueueTab }) {
  const link = useAppLink()
  return (
    <Button variant="link" size="sm" className="h-auto px-0" render={<Link to={link(filter ? `/leads?qualificationStatus=${filter}` : '/leads')} />} nativeButton={false}>
      {filter ? 'See all in Leads' : 'Go to Leads'}
    </Button>
  )
}

function QueueTable({ leads, settings }: { leads: Lead[]; settings?: AiSettings }) {
  const link = useAppLink()
  const qualify = useQualifyLead()
  const runningId = qualify.isPending ? qualify.variables : null

  const run = (lead: Lead) => {
    qualify.mutate(lead.id, {
      onSuccess: (result) => {
        const q = result.qualification
        toast.success(`Qualified ${lead.name}`, {
          description: q ? `AI estimate: score ${q.score}, ${q.priority} priority.` : 'The run finished without a saved score.',
        })
      },
      onError: (error) => {
        const t = aiErrorToast(error)
        toast.error(t.title, { description: t.description })
      },
    })
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
            <TableHead className="hidden sm:table-cell">Score</TableHead>
            <TableHead className="hidden lg:table-cell">Reason</TableHead>
            <TableHead className="hidden md:table-cell">Created</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell className="max-w-56">
                <div className="flex items-center gap-1.5">
                  <Link to={link(`/leads/${lead.id}`)} className="truncate font-medium hover:underline">
                    {lead.name}
                  </Link>
                  {lead.isSample ? <SampleBadge /> : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">{lead.company}</div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <QualificationStatusBadge status={lead.qualificationStatus} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <ScoreBadge score={lead.score} thresholds={settings?.thresholds} />
              </TableCell>
              <TableCell className="hidden max-w-64 truncate text-muted-foreground lg:table-cell" title={lead.qualificationError ?? undefined}>
                {lead.qualificationError ?? (lead.confidence !== null ? `Confidence ${Math.round(lead.confidence * 100)}%` : '—')}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <RelativeTime value={lead.createdAt} className="text-muted-foreground" />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <ReadOnlyGuard action="run AI qualification" minRole="member">
                    <Button size="sm" variant="outline" onClick={() => run(lead)} disabled={qualify.isPending} aria-label={`Run AI qualification for ${lead.name}`}>
                      <Play aria-hidden="true" className={runningId === lead.id ? 'animate-pulse' : undefined} />
                      {runningId === lead.id ? 'Running…' : 'Run AI'}
                    </Button>
                  </ReadOnlyGuard>
                  <Button size="sm" variant="ghost" render={<Link to={link(`/leads/${lead.id}`)} />} nativeButton={false} aria-label={`Open ${lead.name}`}>
                    Open
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border p-3" aria-busy="true" aria-label="Loading queue">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-7 w-24" />
        </div>
      ))}
    </div>
  )
}
