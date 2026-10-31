import type { WorkflowExecution } from '@leadpilot/shared'
import { Link } from 'react-router'
import { useAppLink } from '@/app/data-mode'
import { EngineBadge, ExecutionStatusBadge, RelativeTime, SampleBadge } from '@/components/app'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDuration, formatEnumLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { WORKFLOW_LABEL } from './labels'

interface ExecutionsTableProps {
  executions: WorkflowExecution[]
  onSelect: (id: string) => void
  selectedId?: string | null
  /** Hides secondary columns (used inside other pages). */
  compact?: boolean
}

export function ExecutionsTable({ executions, onSelect, selectedId, compact }: ExecutionsTableProps) {
  const link = useAppLink()
  const hide = compact ? 'hidden' : ''

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Workflow</TableHead>
            <TableHead className="hidden sm:table-cell">Lead</TableHead>
            <TableHead className={cn('hidden lg:table-cell', hide)}>Trigger</TableHead>
            <TableHead className="hidden md:table-cell">Engine</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Duration</TableHead>
            <TableHead className={cn('hidden lg:table-cell', hide)}>Attempt</TableHead>
            <TableHead className="hidden xl:table-cell">Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {executions.map((ex) => (
            <TableRow
              key={ex.id}
              tabIndex={0}
              aria-label={`Open execution: ${WORKFLOW_LABEL[ex.workflowKey]}, ${ex.status}`}
              data-state={selectedId === ex.id ? 'selected' : undefined}
              className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
              onClick={() => onSelect(ex.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(ex.id)
                }
              }}
            >
              <TableCell className="whitespace-nowrap text-muted-foreground">
                <RelativeTime value={ex.startedAt} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="font-medium">{WORKFLOW_LABEL[ex.workflowKey]}</span>
                  {ex.isSample ? <SampleBadge /> : null}
                </div>
              </TableCell>
              <TableCell className="hidden max-w-44 truncate sm:table-cell">
                {ex.leadId ? (
                  <Link to={link(`/leads/${ex.leadId}`)} onClick={(e) => e.stopPropagation()} className="hover:underline">
                    {ex.leadName ?? 'View lead'}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className={cn('hidden whitespace-nowrap text-muted-foreground lg:table-cell', hide)}>{formatEnumLabel(ex.trigger)}</TableCell>
              <TableCell className="hidden md:table-cell">
                <EngineBadge engine={ex.engine} />
              </TableCell>
              <TableCell>
                <ExecutionStatusBadge status={ex.status} />
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatDuration(ex.durationMs)}</TableCell>
              <TableCell className={cn('hidden whitespace-nowrap lg:table-cell', hide)}>
                {ex.retryOfId ? (
                  <button
                    type="button"
                    className="text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(ex.retryOfId!)
                    }}
                    title="Open the original execution"
                  >
                    Retry #{ex.attempt - 1}
                  </button>
                ) : (
                  <span className="text-muted-foreground tabular-nums">{ex.attempt}</span>
                )}
              </TableCell>
              <TableCell className="hidden max-w-60 truncate text-danger xl:table-cell" title={ex.errorMessage ?? undefined}>
                {ex.errorCode ?? ex.errorMessage ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ExecutionsTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-0 overflow-hidden rounded-lg border" aria-busy="true" aria-label="Loading executions">
      <div className="h-9 border-b bg-muted/30" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="hidden h-3.5 w-32 sm:block" />
          <Skeleton className="ml-auto h-5 w-20" />
          <Skeleton className="hidden h-3.5 w-12 sm:block" />
        </div>
      ))}
    </div>
  )
}
