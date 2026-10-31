import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { LEAD_PRIORITIES, QUALIFICATION_STATUSES, type AnalyticsResponse } from '@leadpilot/shared'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts'
import { ChartColumn } from 'lucide-react'
import { useAnalytics } from '@/api'
import { useAppLink } from '@/app/data-mode'
import { AiDisclaimer, EmptyState, ErrorState, PageHeader, SampleBadge } from '@/components/app'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { formatEnumLabel, formatNumber, formatPercent, formatShortDate, pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SampleNotice, SectionCard } from '../dashboard/sections'

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

function parseRange(value: string | null): Range {
  const n = Number(value)
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : 30
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const days = parseRange(params.get('days'))
  const analytics = useAnalytics(days)
  const data = analytics.data
  // keepPreviousData: show the old range dimmed while the new one loads.
  const stale = analytics.isPlaceholderData

  const setDays = (next: Range) => {
    const p = new URLSearchParams(params)
    if (next === 30) p.delete('days')
    else p.set('days', String(next))
    setParams(p, { replace: true })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Lead volume, sources, scores and workflow outcomes over time."
        meta={data && data.sampleRecordCount > 0 ? <SampleBadge /> : null}
        actions={<RangeControl value={days} onChange={setDays} />}
      />
      {analytics.isError && !data ? (
        <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} retrying={analytics.isFetching} />
      ) : (
        <>
          {data ? <SampleNotice count={data.sampleRecordCount} /> : null}
          <div className={cn('grid gap-4 lg:grid-cols-2', stale && 'opacity-60 transition-opacity')} aria-busy={stale || !data}>
            <LeadVolumeChart data={data} days={days} />
            <SourcesChart data={data} days={days} />
            <ScoreChart data={data} days={days} />
            <QualificationChart data={data} days={days} />
            <PriorityChart data={data} days={days} />
            <WorkflowChart data={data} days={days} />
          </div>
        </>
      )}
    </div>
  )
}

function RangeControl({ value, onChange }: { value: Range; onChange: (v: Range) => void }) {
  return (
    <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg bg-muted p-[3px]">
      {RANGES.map((r) => (
        <Button
          key={r}
          role="radio"
          aria-checked={value === r}
          size="sm"
          variant="ghost"
          onClick={() => onChange(r)}
          className={cn('px-3 text-[13px]', value === r ? 'bg-background text-foreground shadow-xs hover:bg-background' : 'text-muted-foreground')}
        >
          {r} days
        </Button>
      ))}
    </div>
  )
}

interface ChartProps {
  data: AnalyticsResponse | undefined
  days: number
}

function ChartCard({
  title,
  description,
  loading,
  empty,
  emptyText,
  footer,
  children,
}: {
  title: string
  description: string
  loading: boolean
  empty: boolean
  emptyText: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <SectionCard title={title} description={description}>
      {loading ? (
        <Skeleton className="h-60 w-full" />
      ) : empty ? (
        <div className="flex h-60 items-center justify-center">
          <EmptyState size="compact" icon={ChartColumn} title="No data in this range" description={emptyText} />
        </div>
      ) : (
        <div className="space-y-3">
          {children}
          {footer}
        </div>
      )}
    </SectionCard>
  )
}

function LeadsLink() {
  const link = useAppLink()
  return (
    <Link to={link('/leads')} className="font-medium text-primary hover:underline">
      Go to Leads
    </Link>
  )
}

const volumeConfig = { count: { label: 'Leads', color: 'var(--chart-1)' } } satisfies ChartConfig

function LeadVolumeChart({ data, days }: ChartProps) {
  const points = data?.leadVolume ?? []
  const total = points.reduce((s, p) => s + p.count, 0)
  return (
    <ChartCard
      title="Lead volume"
      description={`New leads per day · ${pluralize(total, 'lead')} in ${days} days`}
      loading={!data}
      empty={total === 0}
      emptyText={<>No leads were created in the last {days} days. <LeadsLink /></>}
    >
      <ChartContainer config={volumeConfig} className="aspect-auto h-60 w-full" role="img" aria-label={`Area chart: new leads per day over the last ${days} days, ${total} in total`}>
        <AreaChart data={points} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(v: string) => formatShortDate(v)} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
          <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(_, p) => formatShortDate(String(p?.[0]?.payload?.date ?? ''))} />} />
          <Area dataKey="count" type="monotone" stroke="var(--color-count)" fill="var(--color-count)" fillOpacity={0.12} strokeWidth={2} />
        </AreaChart>
      </ChartContainer>
    </ChartCard>
  )
}

const countConfig = { count: { label: 'Leads', color: 'var(--chart-1)' } } satisfies ChartConfig

function SourcesChart({ data, days }: ChartProps) {
  const rows = [...(data?.sources ?? [])].sort((a, b) => b.count - a.count).map((s) => ({ label: formatEnumLabel(s.source), count: s.count }))
  const total = rows.reduce((s, r) => s + r.count, 0)
  return (
    <ChartCard title="Lead sources" description="Where new leads came from." loading={!data} empty={total === 0} emptyText={`No leads in the last ${days} days.`}>
      <ChartContainer
        config={countConfig}
        className="aspect-auto w-full"
        style={{ height: Math.max(rows.length * 32 + 16, 120) }}
        role="img"
        aria-label={`Horizontal bar chart of lead sources: ${rows.map((r) => `${r.label} ${r.count}`).join(', ')}`}
      >
        <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 32 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={110} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={4} barSize={18}>
            <LabelList dataKey="count" position="right" className="fill-foreground tabular-nums" fontSize={12} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}

const scoreConfig = { count: { label: 'Leads', color: 'var(--chart-1)' } } satisfies ChartConfig

function ScoreChart({ data, days }: ChartProps) {
  const rows = data?.scoreDistribution ?? []
  const total = rows.reduce((s, r) => s + r.count, 0)
  return (
    <ChartCard
      title="AI score distribution"
      description="Scored leads per 20-point score bucket."
      loading={!data}
      empty={total === 0}
      emptyText={`No leads were scored in the last ${days} days.`}
      footer={<AiDisclaimer />}
    >
      <ChartContainer config={scoreConfig} className="aspect-auto h-60 w-full" role="img" aria-label={`Histogram of AI scores: ${rows.map((r) => `${r.bucket}: ${r.count}`).join(', ')}`}>
        <BarChart data={rows} margin={{ top: 20, left: 0, right: 8 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator labelFormatter={(v) => `Score ${String(v)}`} />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="count" position="top" className="fill-foreground tabular-nums" fontSize={12} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}

const QUAL_COLORS: Record<string, string> = {
  pending: 'var(--muted-foreground)',
  processing: 'var(--info)',
  completed: 'var(--success)',
  needs_review: 'var(--warning)',
  failed: 'var(--destructive)',
  skipped: 'var(--muted-foreground)',
}

function QualificationChart({ data, days }: ChartProps) {
  const byStatus = new Map(data?.qualificationResults.map((r) => [r.status, r.count]))
  const rows = QUALIFICATION_STATUSES.map((s) => ({ key: s, label: formatEnumLabel(s), count: byStatus.get(s) ?? 0 }))
  const total = rows.reduce((s, r) => s + r.count, 0)
  return (
    <ChartCard title="Qualification results" description="AI qualification status of leads created in range." loading={!data} empty={total === 0} emptyText={`No leads in the last ${days} days.`}>
      <CategoryBars rows={rows} colors={QUAL_COLORS} total={total} label="Qualification status" />
    </ChartCard>
  )
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'var(--success)',
  medium: 'var(--warning)',
  low: 'var(--muted-foreground)',
  unscored: 'var(--border)',
}

function PriorityChart({ data, days }: ChartProps) {
  const byPriority = new Map(data?.priorities.map((r) => [r.priority, r.count]))
  const rows = [...LEAD_PRIORITIES, 'unscored' as const].map((p) => ({ key: p, label: formatEnumLabel(p), count: byPriority.get(p) ?? 0 }))
  const total = rows.reduce((s, r) => s + r.count, 0)
  return (
    <ChartCard title="Priority mix" description="Priority band of leads created in range." loading={!data} empty={total === 0} emptyText={`No leads in the last ${days} days.`}>
      <CategoryBars rows={rows} colors={PRIORITY_COLORS} total={total} label="Priority" />
    </ChartCard>
  )
}

/** Horizontal bars for a small fixed category set, with direct count + share labels (colour never stands alone). */
function CategoryBars({
  rows,
  colors,
  total,
  label,
}: {
  rows: { key: string; label: string; count: number }[]
  colors: Record<string, string>
  total: number
  label: string
}) {
  const config = { count: { label: 'Leads' } } satisfies ChartConfig
  const withLabels = rows.map((r) => ({ ...r, display: `${formatNumber(r.count)} · ${formatPercent(total > 0 ? r.count / total : null)}` }))
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: rows.length * 32 + 16 }}
      role="img"
      aria-label={`${label} bar chart: ${withLabels.map((r) => `${r.label} ${r.display}`).join(', ')}`}
    >
      <BarChart data={withLabels} layout="vertical" margin={{ left: 0, right: 72 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={100} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="count" radius={4} barSize={18} minPointSize={2}>
          {withLabels.map((r) => (
            <Cell key={r.key} fill={colors[r.key]} />
          ))}
          <LabelList dataKey="display" position="right" className="fill-foreground tabular-nums" fontSize={12} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

const workflowConfig = {
  succeeded: { label: 'Succeeded', color: 'var(--success)' },
  partial: { label: 'Partial', color: 'var(--warning)' },
  failed: { label: 'Failed', color: 'var(--destructive)' },
} satisfies ChartConfig

function WorkflowChart({ data, days }: ChartProps) {
  const link = useAppLink()
  const rows = data?.workflowOutcomes ?? []
  const sum = rows.reduce((acc, r) => ({ succeeded: acc.succeeded + r.succeeded, partial: acc.partial + r.partial, failed: acc.failed + r.failed }), {
    succeeded: 0,
    partial: 0,
    failed: 0,
  })
  const finished = sum.succeeded + sum.partial + sum.failed
  const successRate = finished > 0 ? sum.succeeded / finished : null
  return (
    <ChartCard
      title="Workflow outcomes"
      description="Finished executions per day."
      loading={!data}
      empty={finished === 0}
      emptyText={
        <>
          No finished workflow runs in the last {days} days.{' '}
          <Link to={link('/workflows')} className="font-medium text-primary hover:underline">
            Go to Workflows
          </Link>
        </>
      }
      footer={
        <p className="text-[13px] text-muted-foreground">
          Success rate <span className="font-semibold tabular-nums text-foreground">{formatPercent(successRate, 1)}</span> ({formatNumber(sum.succeeded)} of{' '}
          {pluralize(finished, 'finished run')}; partial runs count as not successful)
        </p>
      }
    >
      <ChartContainer
        config={workflowConfig}
        className="aspect-auto h-60 w-full"
        role="img"
        aria-label={`Stacked bar chart of workflow outcomes over ${days} days: ${sum.succeeded} succeeded, ${sum.partial} partial, ${sum.failed} failed`}
      >
        <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(v: string) => formatShortDate(v)} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => formatShortDate(String(p?.[0]?.payload?.date ?? ''))} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="succeeded" stackId="a" fill="var(--color-succeeded)" />
          <Bar dataKey="partial" stackId="a" fill="var(--color-partial)" />
          <Bar dataKey="failed" stackId="a" fill="var(--color-failed)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}
