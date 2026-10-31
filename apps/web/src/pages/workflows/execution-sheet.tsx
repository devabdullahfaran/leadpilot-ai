import type { ReactNode } from 'react'
import type { WorkflowExecution } from '@leadpilot/shared'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { RotateCcw } from 'lucide-react'
import { useExecution, useRetryExecution } from '@/api'
import { useAppLink } from '@/app/data-mode'
import { EngineBadge, ErrorState, ExecutionStatusBadge, ReadOnlyGuard, SampleBadge, StatusBadge } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatDuration, formatEnumLabel } from '@/lib/format'
import { aiErrorToast } from '../qualification/ai-errors'
import { WORKFLOW_LABEL } from './labels'
import { StepTimeline } from './step-timeline'

/** Server-side retry rules: Worker runs that failed or partially failed and still have a lead. */
function isRetryable(ex: WorkflowExecution): boolean {
  return (ex.status === 'failed' || ex.status === 'partial') && ex.engine === 'worker' && Boolean(ex.leadId)
}

interface ExecutionSheetProps {
  executionId: string | null
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
}

export function ExecutionSheet({ executionId, onOpenChange, onSelect }: ExecutionSheetProps) {
  return (
    <Sheet open={Boolean(executionId)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {executionId ? <ExecutionDetailBody id={executionId} onSelect={onSelect} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function ExecutionDetailBody({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const link = useAppLink()
  const execution = useExecution(id)
  const retry = useRetryExecution()

  if (execution.isPending) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Execution</SheetTitle>
          <SheetDescription>Loading execution details…</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4" aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </>
    )
  }
  if (execution.isError) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Execution</SheetTitle>
          <SheetDescription className="sr-only">The execution could not be loaded.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <ErrorState size="compact" error={execution.error} onRetry={() => void execution.refetch()} retrying={execution.isFetching} />
        </div>
      </>
    )
  }

  const ex = execution.data
  const runRetry = () =>
    retry.mutate(
      { executionId: ex.id, leadId: ex.leadId },
      {
        onSuccess: (result) => {
          toast.success('Retry started', {
            description: `New execution ${formatEnumLabel(result.execution.status).toLowerCase()}.`,
          })
          onSelect(result.execution.id)
        },
        onError: (err) => {
          const { title, description } = aiErrorToast(err)
          toast.error(title, { description })
        },
      },
    )

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <SheetTitle>{WORKFLOW_LABEL[ex.workflowKey]}</SheetTitle>
          <ExecutionStatusBadge status={ex.status} />
          {ex.isSample ? <SampleBadge /> : null}
        </div>
        <SheetDescription>
          Started {formatDateTime(ex.startedAt)}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <Field label="Engine">
            <EngineBadge engine={ex.engine} />
          </Field>
          <Field label="Trigger">{formatEnumLabel(ex.trigger)}</Field>
          <Field label="Duration">
            <span className="tabular-nums">{ex.finishedAt ? formatDuration(ex.durationMs) : 'Still running'}</span>
          </Field>
          <Field label="Finished">{ex.finishedAt ? formatDateTime(ex.finishedAt) : '—'}</Field>
          <Field label="Lead">
            {ex.leadId ? (
              <Link to={link(`/leads/${ex.leadId}`)} className="text-primary hover:underline">
                {ex.leadName ?? 'View lead'}
              </Link>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Attempt">
            {ex.retryOfId ? (
              <button type="button" onClick={() => onSelect(ex.retryOfId!)} className="text-primary hover:underline">
                Retry #{ex.attempt - 1} · open original
              </button>
            ) : (
              <span className="tabular-nums">{ex.attempt}</span>
            )}
          </Field>
        </dl>

        {ex.errorCode || ex.errorMessage ? (
          <section aria-labelledby="ex-error" className="space-y-1.5 rounded-lg border border-danger/30 bg-danger/5 p-3">
            <h3 id="ex-error" className="text-[13px] font-medium text-danger">
              Error{ex.errorCode ? <code className="ml-2 font-mono text-xs">{ex.errorCode}</code> : null}
            </h3>
            {ex.errorMessage ? <p className="text-[13px] break-words">{ex.errorMessage}</p> : null}
          </section>
        ) : null}

        <section aria-labelledby="ex-steps" className="space-y-2">
          <h3 id="ex-steps" className="text-[13px] font-medium">
            Steps
          </h3>
          <StepTimeline steps={ex.steps} />
        </section>

        <section aria-labelledby="ex-notifications" className="space-y-2">
          <h3 id="ex-notifications" className="text-[13px] font-medium">
            Notifications
          </h3>
          {ex.notifications.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No notifications were sent for this execution.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-[13px]">
              {ex.notifications.map((n) => (
                <li key={n.id} className="space-y-1 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{formatEnumLabel(n.channel)}</span>
                    <StatusBadge tone={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'danger' : 'neutral'}>
                      {formatEnumLabel(n.status)}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                  {n.error ? <p className="text-xs break-words text-danger">{n.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {isRetryable(ex) ? (
        <SheetFooter className="border-t">
          <ReadOnlyGuard action="retry executions" minRole="member">
            <Button onClick={runRetry} disabled={retry.isPending}>
              <RotateCcw />
              {retry.isPending ? 'Retrying…' : 'Retry execution'}
            </Button>
          </ReadOnlyGuard>
          <p className="text-xs text-muted-foreground">Re-runs the Worker pipeline for this lead and records a new execution.</p>
        </SheetFooter>
      ) : null}
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  )
}
