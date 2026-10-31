import { useCallback } from 'react'
import { EXECUTION_STATUSES, WORKFLOW_ENGINES, WORKFLOW_KEYS, type WorkflowOverviewItem } from '@leadpilot/shared'
import { useSearchParams } from 'react-router'
import { History } from 'lucide-react'
import { useExecutions } from '@/api'
import type { ExecutionListParams } from '@/api'
import { DataPagination, EmptyState, ErrorState, PageHeader } from '@/components/app'
import { Button } from '@/components/ui/button'
import { formatEnumLabel } from '@/lib/format'
import { ExecutionSheet } from './execution-sheet'
import { ExecutionsTable, ExecutionsTableSkeleton } from './executions-table'
import { FilterSelect, type FilterOption } from './filter-select'
import { IntegrationHealth } from './integration-health'
import { WORKFLOW_LABEL } from './labels'
import { OverviewCards } from './overview'

const ALL = 'all'
const STATUS_OPTIONS: FilterOption[] = [{ value: ALL, label: 'All statuses' }, ...EXECUTION_STATUSES.map((s) => ({ value: s, label: formatEnumLabel(s) }))]
const WORKFLOW_OPTIONS: FilterOption[] = [{ value: ALL, label: 'All workflows' }, ...WORKFLOW_KEYS.map((k) => ({ value: k, label: WORKFLOW_LABEL[k] }))]
const ENGINE_OPTIONS: FilterOption[] = [
  { value: ALL, label: 'All engines' },
  ...WORKFLOW_ENGINES.map((e) => ({ value: e, label: e === 'n8n' ? 'n8n · self-hosted' : 'Worker' })),
]

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function WorkflowsPage() {
  const [params, setParams] = useSearchParams()
  const list: ExecutionListParams = {
    status: pick(params.get('status'), EXECUTION_STATUSES),
    workflowKey: pick(params.get('workflow'), WORKFLOW_KEYS),
    engine: pick(params.get('engine'), WORKFLOW_ENGINES),
    page: positiveInt(params.get('page'), 1),
    pageSize: Math.min(100, positiveInt(params.get('pageSize'), 25)),
  }
  const selectedId = params.get('execution')
  const executions = useExecutions(list)

  const update = useCallback(
    (changes: Record<string, string | number | null>, resetPage = true) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === ALL || value === '') next.delete(key)
          else next.set(key, String(value))
        }
        if (resetPage) next.delete('page')
        return next
      })
    },
    [setParams],
  )

  const openExecution = (id: string | null) => update({ execution: id }, false)
  const filtered = Boolean(list.status || list.workflowKey || list.engine)
  const filterByOverview = (item: WorkflowOverviewItem) => update({ workflow: item.workflowKey, engine: item.engine, status: null })

  return (
    <div className="space-y-6">
      <PageHeader title="Workflows" description="Automation runs across the Worker pipeline and self-hosted n8n." />

      <OverviewCards onFilter={filterByOverview} />
      <IntegrationHealth />

      <section aria-labelledby="executions-heading" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="executions-heading" className="text-sm font-medium">
            Executions
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <FilterSelect aria-label="Filter by status" value={list.status ?? ALL} onValueChange={(v) => update({ status: v })} options={STATUS_OPTIONS} className="sm:w-36" />
            <FilterSelect aria-label="Filter by workflow" value={list.workflowKey ?? ALL} onValueChange={(v) => update({ workflow: v })} options={WORKFLOW_OPTIONS} />
            <FilterSelect aria-label="Filter by engine" value={list.engine ?? ALL} onValueChange={(v) => update({ engine: v })} options={ENGINE_OPTIONS} className="sm:w-40" />
            {filtered ? (
              <Button variant="ghost" size="sm" onClick={() => update({ status: null, workflow: null, engine: null })}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {executions.isPending ? (
          <ExecutionsTableSkeleton />
        ) : executions.isError ? (
          <ErrorState error={executions.error} onRetry={() => void executions.refetch()} retrying={executions.isFetching} />
        ) : executions.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={History}
              title="No executions match these filters"
              description="Try a different status, workflow or engine."
              action={
                <Button variant="outline" size="sm" onClick={() => update({ status: null, workflow: null, engine: null })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={History}
              title="No executions yet"
              description="Executions are recorded when a lead is submitted through the intake webhook, when a lead is created and qualified with AI, or when n8n writes a run back."
            />
          )
        ) : (
          <>
            {executions.data.data.some((ex) => ex.isSample) ? (
              <p className="text-xs text-muted-foreground">Rows marked Sample are synthetic demo records, not real runs.</p>
            ) : null}
            <ExecutionsTable executions={executions.data.data} onSelect={openExecution} selectedId={selectedId} />
            <DataPagination
              page={executions.data.page}
              pageSize={executions.data.pageSize}
              total={executions.data.total}
              onPageChange={(page) => update({ page }, false)}
              onPageSizeChange={(pageSize) => update({ pageSize })}
              isFetching={executions.isFetching}
            />
          </>
        )}
      </section>

      <ExecutionSheet executionId={selectedId} onOpenChange={(open) => !open && openExecution(null)} onSelect={openExecution} />
    </div>
  )
}
