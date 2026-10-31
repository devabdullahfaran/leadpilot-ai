import { Link, useNavigate } from 'react-router'
import { LEAD_STATUSES, type DashboardSummary, type ExecutionStatus } from '@leadpilot/shared'
import { CircleCheck, FlaskConical, Plug, Sparkles, TriangleAlert, UserPlus, Users } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { useAnalytics, useDashboardSummary } from '@/api'
import {
  EmptyState,
  ErrorState,
  ExecutionStatusBadge,
  PageHeader,
  PriorityBadge,
  QualificationStatusBadge,
  ReadOnlyGuard,
  RelativeTime,
  SampleBadge,
  ScoreBadge,
  StatCard,
} from '@/components/app'
import { useAppLink, useDataMode } from '@/app/data-mode'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatEnumLabel, formatNumber, formatPercent, formatShortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SampleNotice, SectionCard, SectionSkeleton } from './sections'
import { ratio } from './ratio'

export function DashboardPage() {
  const summary = useDashboardSummary()
  const { readOnly } = useDataMode()
  const data = summary.data

  const header = (
    <PageHeader
      title="Dashboard"
      description="Pipeline health, AI activity and workflow status at a glance."
      meta={data && data.sampleRecordCount > 0 ? <SampleBadge /> : null}
    />
  )

  if (summary.isError && !data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} retrying={summary.isFetching} />
      </div>
    )
  }

  // Onboarding only for a real, empty workspace; the preview always has data or shows normal empty states.
  if (data && data.totals.leads === 0 && !readOnly) {
    return (
      <div className="space-y-6">
        {header}
        <Onboarding />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      {data ? <SampleNotice count={data.sampleRecordCount} /> : null}
      <KpiRow data={data} />
      <div className="grid gap-4 lg:grid-cols-3">
        <ConversionCard data={data} className="lg:col-span-2" />
        <AiActivityCard data={data} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <LeadVolumeCard className="lg:col-span-2" />
        <WorkflowStatusCard data={data} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <RecentLeadsCard data={data} className="lg:col-span-2" />
        <RecentErrorsCard data={data} />
      </div>
    </div>
  )
}

type MaybeSummary = { data: DashboardSummary | undefined; className?: string }

function KpiRow({ data }: MaybeSummary) {
  const loading = !data
  const t = data?.totals
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="Total leads" icon={Users} loading={loading} value={formatNumber(t?.leads)} hint="All leads in this workspace, including sample records." />
      <StatCard
        label="Qualified"
        icon={CircleCheck}
        loading={loading}
        value={formatNumber(t?.qualified)}
        hint="Leads whose AI qualification completed with a high or medium priority."
      />
      <StatCard
        label="High priority"
        icon={Sparkles}
        loading={loading}
        value={formatNumber(t?.highPriority)}
        hint="Leads whose score falls in the high priority band (AI estimate or manual override)."
      />
      <StatCard
        label="Needs review"
        icon={TriangleAlert}
        loading={loading}
        value={formatNumber(t?.needsReview)}
        hint="Leads whose qualification needs a human look (low confidence) or failed."
      />
    </div>
  )
}

function ConversionCard({ data, className }: MaybeSummary) {
  const link = useAppLink()
  const counts = new Map(data?.conversion.map((c) => [c.status, c.count]))
  const total = data?.conversion.reduce((sum, c) => sum + c.count, 0) ?? 0
  return (
    <SectionCard title="Conversion overview" description="Leads by sales status, in pipeline order." link={{ to: link('/leads'), label: 'Leads' }} className={className}>
      {!data ? (
        <SectionSkeleton rows={7} />
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2.5" aria-label="Leads by sales status">
            {LEAD_STATUSES.map((status) => {
              const count = counts.get(status) ?? 0
              const share = ratio(count, total)
              return (
                <li key={status} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="truncate text-muted-foreground">{formatEnumLabel(status)}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(share ?? 0) * 100}%` }} />
                  </div>
                  <span className="w-20 text-right tabular-nums">
                    <span className="font-medium text-foreground">{formatNumber(count)}</span>
                    <span className="ml-1.5 text-muted-foreground">{formatPercent(share)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="flex items-baseline justify-between border-t pt-3 text-[13px]">
            <span className="text-muted-foreground" title="Won ÷ (won + lost). Shown as — until a deal is closed.">
              Win rate
            </span>
            <span className="text-base font-semibold tabular-nums">{formatPercent(data.winRate, 1)}</span>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function AiActivityCard({ data, className }: MaybeSummary) {
  const link = useAppLink()
  const ai = data?.aiActivity
  const used = ai ? Math.min(ai.todayUsed / Math.max(ai.dailyLimit, 1), 1) : 0
  return (
    <SectionCard title="AI qualification" description="Runs in the last 7 days." link={{ to: link('/qualification'), label: 'Open' }} className={className}>
      {!ai ? (
        <SectionSkeleton rows={4} />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-3 text-[13px]">
            <Metric label="Runs" value={formatNumber(ai.last7Days)} />
            <Metric label="Succeeded" value={formatNumber(ai.succeeded)} tone="text-success" />
            <Metric label="Failed" value={formatNumber(ai.failed)} tone={ai.failed > 0 ? 'text-danger' : undefined} />
          </dl>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-muted-foreground">Today’s quota</span>
              <span className="tabular-nums">
                {formatNumber(ai.todayUsed)} of {formatNumber(ai.dailyLimit)} today
              </span>
            </div>
            <div
              role="meter"
              aria-label="AI calls used today"
              aria-valuemin={0}
              aria-valuemax={ai.dailyLimit}
              aria-valuenow={ai.todayUsed}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className={cn('h-full rounded-full', used >= 1 ? 'bg-danger' : used >= 0.8 ? 'bg-warning' : 'bg-primary')} style={{ width: `${used * 100}%` }} />
            </div>
            {used >= 1 ? <p className="text-xs text-danger">Daily limit reached. New runs resume after UTC midnight.</p> : null}
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-lg font-semibold tabular-nums text-foreground', tone)}>{value}</dd>
    </div>
  )
}

const WORKFLOW_SEGMENTS: { status: ExecutionStatus; className: string }[] = [
  { status: 'succeeded', className: 'bg-success' },
  { status: 'partial', className: 'bg-warning' },
  { status: 'failed', className: 'bg-danger' },
  { status: 'running', className: 'bg-info' },
]

function WorkflowStatusCard({ data, className }: MaybeSummary) {
  const link = useAppLink()
  const ws = data?.workflowStatus
  const total = ws ? ws.succeeded + ws.partial + ws.failed + ws.running : 0
  return (
    <SectionCard title="Workflow executions" description="Status of runs in the last 7 days." link={{ to: link('/workflows'), label: 'Workflows' }} className={className}>
      {!ws ? (
        <SectionSkeleton rows={4} />
      ) : total === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">No workflow runs in the last 7 days.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {WORKFLOW_SEGMENTS.map(({ status, className: fill }) =>
              ws[status] > 0 ? <div key={status} className={fill} style={{ width: `${(ws[status] / total) * 100}%` }} /> : null,
            )}
          </div>
          <ul className="space-y-2 text-[13px]">
            {WORKFLOW_SEGMENTS.map(({ status }) => (
              <li key={status} className="flex items-center justify-between">
                <ExecutionStatusBadge status={status} />
                <span className="tabular-nums">
                  <span className="font-medium">{formatNumber(ws[status])}</span>
                  <span className="ml-1.5 text-muted-foreground">{formatPercent(ratio(ws[status], total))}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}

const volumeConfig = { count: { label: 'Leads', color: 'var(--chart-1)' } } satisfies ChartConfig

function LeadVolumeCard({ className }: { className?: string }) {
  const link = useAppLink()
  const analytics = useAnalytics(30)
  const points = analytics.data?.leadVolume ?? []
  const empty = points.every((p) => p.count === 0)
  return (
    <SectionCard title="Lead volume" description="New leads per day, last 30 days." link={{ to: link('/analytics'), label: 'Analytics' }} className={className}>
      {analytics.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : analytics.isError ? (
        <ErrorState size="compact" error={analytics.error} onRetry={() => void analytics.refetch()} retrying={analytics.isFetching} />
      ) : empty ? (
        <p className="py-16 text-center text-[13px] text-muted-foreground">No new leads in the last 30 days.</p>
      ) : (
        <ChartContainer config={volumeConfig} className="aspect-auto h-48 w-full" role="img" aria-label="Area chart of new leads per day over the last 30 days">
          <AreaChart data={points} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(v: string) => formatShortDate(v)} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(_, p) => formatShortDate(String(p?.[0]?.payload?.date ?? ''))} />} />
            <Area dataKey="count" type="monotone" stroke="var(--color-count)" fill="var(--color-count)" fillOpacity={0.12} strokeWidth={2} />
          </AreaChart>
        </ChartContainer>
      )}
    </SectionCard>
  )
}

function RecentLeadsCard({ data, className }: MaybeSummary) {
  const link = useAppLink()
  return (
    <SectionCard title="Recent leads" link={{ to: link('/leads'), label: 'All leads' }} className={className} contentClassName="px-0">
      {!data ? (
        <SectionSkeleton rows={5} className="px-4" />
      ) : data.recentLeads.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">No leads yet.</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Lead</TableHead>
              <TableHead>Score</TableHead>
              <TableHead className="hidden sm:table-cell">Priority</TableHead>
              <TableHead className="hidden md:table-cell">Qualification</TableHead>
              <TableHead className="pr-4 text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.recentLeads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="max-w-56 pl-4">
                  <div className="flex items-center gap-1.5">
                    <Link to={link(`/leads/${lead.id}`)} className="truncate font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                      {lead.name}
                    </Link>
                    {lead.isSample ? <SampleBadge /> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{lead.company}</div>
                </TableCell>
                <TableCell>
                  <ScoreBadge score={lead.score} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <PriorityBadge priority={lead.priority} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <QualificationStatusBadge status={lead.qualificationStatus} />
                </TableCell>
                <TableCell className="pr-4 text-right text-muted-foreground">
                  <RelativeTime value={lead.createdAt} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  )
}

function RecentErrorsCard({ data, className }: MaybeSummary) {
  const link = useAppLink()
  return (
    <SectionCard title="Recent automation errors" description="Failed and partial executions." link={{ to: link('/workflows'), label: 'Workflows' }} className={className}>
      {!data ? (
        <SectionSkeleton rows={4} />
      ) : data.recentErrors.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-[13px] text-muted-foreground">
          <CircleCheck className="size-5 text-success" aria-hidden="true" />
          No failed or partial executions.
        </div>
      ) : (
        <ul className="-mx-2 space-y-1">
          {data.recentErrors.map((ex) => (
            <li key={ex.id}>
              <Link
                to={`${link('/workflows')}?execution=${encodeURIComponent(ex.id)}`}
                className="block space-y-1 rounded-lg px-2 py-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ExecutionStatusBadge status={ex.status} />
                    <span className="truncate text-[13px] font-medium">{formatEnumLabel(ex.workflowKey)}</span>
                    {ex.isSample ? <SampleBadge /> : null}
                  </span>
                  <RelativeTime value={ex.startedAt} className="text-xs text-muted-foreground" />
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {ex.errorCode ? <code className="mr-1 rounded bg-muted px-1 font-mono text-[11px] text-foreground">{ex.errorCode}</code> : null}
                  {ex.errorMessage ?? 'No error message recorded.'}
                  {ex.leadName ? ` · ${ex.leadName}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function Onboarding() {
  const link = useAppLink()
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={UserPlus}
      title="Your workspace has no leads yet"
      description={
        <>
          Add a lead by hand, load a clearly labeled sample dataset to explore, or connect a website form so new leads arrive and get scored
          automatically.
        </>
      }
      className="py-16"
      action={
        <>
          <ReadOnlyGuard action="create leads" minRole="member">
            <Button onClick={() => void navigate(`${link('/leads')}?new=1`)}>
              <UserPlus aria-hidden="true" />
              Add a lead
            </Button>
          </ReadOnlyGuard>
          <ReadOnlyGuard action="load sample data" minRole="admin">
            <Button variant="outline" onClick={() => void navigate(`${link('/settings')}?tab=sample`)}>
              <FlaskConical aria-hidden="true" />
              Load sample data
            </Button>
          </ReadOnlyGuard>
          <Button variant="outline" render={<Link to={link('/integrations')} />} nativeButton={false}>
            <Plug aria-hidden="true" />
            Set up intake
          </Button>
        </>
      }
    />
  )
}

