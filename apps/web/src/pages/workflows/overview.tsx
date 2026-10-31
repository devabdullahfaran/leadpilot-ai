import type { WorkflowOverviewItem } from '@leadpilot/shared'
import { Workflow } from 'lucide-react'
import { useWorkflowOverview } from '@/api'
import { EmptyState, EngineBadge, ErrorState, ExecutionStatusBadge, RelativeTime } from '@/components/app'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration, formatNumber, formatPercent } from '@/lib/format'
import { WORKFLOW_LABEL } from './labels'

/** Success rate over finished runs (running ones excluded); null when nothing has finished. */
function successRate(item: WorkflowOverviewItem): number | null {
  const finished = item.total - item.running
  return finished > 0 ? item.succeeded / finished : null
}

export function OverviewCards({ onFilter }: { onFilter: (item: WorkflowOverviewItem) => void }) {
  const overview = useWorkflowOverview()

  if (overview.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading workflow overview">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} size="sm">
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }, (_, j) => (
                  <Skeleton key={j} className="h-9" />
                ))}
              </div>
              <Skeleton className="h-4 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }
  if (overview.isError) {
    return <ErrorState size="compact" error={overview.error} onRetry={() => void overview.refetch()} retrying={overview.isFetching} />
  }
  if (overview.data.length === 0) {
    return (
      <EmptyState
        size="compact"
        icon={Workflow}
        title="No workflow runs yet"
        description="Totals appear once a workflow has run at least once."
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {overview.data.map((item) => {
        const rate = successRate(item)
        return (
          <Card key={`${item.workflowKey}-${item.engine}`} size="sm">
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onFilter(item)}
                  className="truncate rounded text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  title="Show these executions"
                >
                  {WORKFLOW_LABEL[item.workflowKey]}
                </button>
                <EngineBadge engine={item.engine} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                <Metric label="Total runs" value={formatNumber(item.total)} />
                <Metric label="Success rate" value={rate === null ? '—' : formatPercent(rate)} hint="Succeeded ÷ finished runs" />
                <Metric label="Failed" value={formatNumber(item.failed)} danger={item.failed > 0} />
                <Metric label="Avg duration" value={formatDuration(item.avgDurationMs)} />
              </dl>
              <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                {item.lastRunAt ? (
                  <>
                    <span>
                      Last run <RelativeTime value={item.lastRunAt} />
                    </span>
                    {item.lastStatus ? <ExecutionStatusBadge status={item.lastStatus} /> : null}
                  </>
                ) : (
                  <span>No runs recorded</span>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Metric({ label, value, hint, danger }: { label: string; value: string; hint?: string; danger?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground" title={hint}>
        {label}
      </dt>
      <dd className={danger ? 'font-medium text-danger tabular-nums' : 'font-medium tabular-nums'}>{value}</dd>
    </div>
  )
}
