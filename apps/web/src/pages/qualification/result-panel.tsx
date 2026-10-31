import type { AiSettings, QualifyResult } from '@leadpilot/shared'
import { Link } from 'react-router'
import { CircleAlert } from 'lucide-react'
import { useAppLink } from '@/app/data-mode'
import {
  AiDisclaimer,
  ExecutionStatusBadge,
  PriorityBadge,
  QualificationStatusBadge,
  SampleBadge,
  ScoreBar,
} from '@/components/app'
import { Button } from '@/components/ui/button'
import { formatDuration, formatEnumLabel, formatPercent } from '@/lib/format'
import { StepTimeline } from '../workflows/step-timeline'
import { explainAiError } from './ai-errors'

interface ResultPanelProps {
  result: QualifyResult
  settings?: AiSettings
}

/** Exactly what the API returned for a qualification run — nothing derived beyond labels. */
export function QualifyResultPanel({ result, settings }: ResultPanelProps) {
  const link = useAppLink()
  const { lead, qualification: q, execution } = result
  const criteriaMeta = new Map(settings?.criteria.map((c) => [c.key, c]) ?? [])

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link to={link(`/leads/${lead.id}`)} className="truncate text-sm font-medium hover:underline">
            {lead.name}
          </Link>
          <span className="text-[13px] text-muted-foreground">{lead.company}</span>
          {lead.isSample ? <SampleBadge /> : null}
        </div>
        <div className="flex items-center gap-2">
          <QualificationStatusBadge status={lead.qualificationStatus} />
          <ExecutionStatusBadge status={execution.status} />
        </div>
      </div>

      {q ? (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Score">
              <ScoreBar score={q.score} thresholds={settings?.thresholds} />
            </Field>
            <Field label="Priority">
              <PriorityBadge priority={q.priority} />
            </Field>
            <Field label="Category">{q.category ? formatEnumLabel(q.category) : '—'}</Field>
            <Field label="Confidence">
              <span className="tabular-nums">{formatPercent(q.confidence)}</span>
            </Field>
          </div>
          {q.summary ? <Field label="Summary">{q.summary}</Field> : null}
          {q.reasoning ? <Field label="Reasoning">{q.reasoning}</Field> : null}
          {q.recommendedAction ? <Field label="Recommended action">{q.recommendedAction}</Field> : null}

          {q.criteria.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Criteria breakdown</p>
              <ul className="divide-y rounded-md border text-[13px]">
                {q.criteria.map((c) => {
                  const meta = criteriaMeta.get(c.key)
                  return (
                    <li key={c.key} className="flex flex-col gap-0.5 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{meta?.label ?? formatEnumLabel(c.key)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          <span className="font-medium text-foreground">{c.score}</span>
                          {meta ? ` / ${meta.maxPoints}` : ''}
                        </span>
                      </div>
                      {c.note ? <span className="text-xs text-muted-foreground">{c.note}</span> : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {q.adjustments.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Backend adjustments to the model output</p>
              <ul className="list-disc space-y-0.5 pl-5 text-[13px]">
                {q.adjustments.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <AiDisclaimer model={q.model} />
          {q.promptVersion ? <p className="text-xs text-muted-foreground">Prompt version <code className="font-mono">{q.promptVersion}</code></p> : null}
        </div>
      ) : (
        <div className="flex gap-2 rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            No qualification was saved for this run.
            {lead.qualificationError ? <> Reason: {lead.qualificationError}</> : null}
          </span>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium">Execution steps</span>
          <span className="tabular-nums">Total {formatDuration(execution.durationMs)}</span>
        </div>
        <StepTimeline steps={execution.steps} />
        {execution.errorCode || execution.errorMessage ? (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            {execution.errorCode ? <code className="mr-1 font-mono">{execution.errorCode}</code> : null}
            {execution.errorMessage}
          </p>
        ) : null}
        <Button variant="link" size="sm" className="h-auto px-0" render={<Link to={link(`/workflows?execution=${execution.id}`)} />} nativeButton={false}>
          View execution
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-[13px] text-foreground">{children}</div>
    </div>
  )
}

/** A failed run: specific explanation for the AI error code, never a fake result. */
export function QualifyErrorPanel({ error }: { error: unknown }) {
  const link = useAppLink()
  const e = explainAiError(error)
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-danger">
        <CircleAlert className="size-4" aria-hidden="true" />
        {e.title}
      </p>
      <p className="text-[13px] text-foreground">{e.description}</p>
      <p className="text-xs text-muted-foreground">
        {e.code ? <code className="mr-1 font-mono">{e.code}</code> : null}
        {e.message}
        {e.retryAfter ? ` Try again in ${e.retryAfter} s.` : null}
      </p>
      {e.fixPath ? (
        <Button variant="outline" size="sm" render={<Link to={link(e.fixPath)} />} nativeButton={false}>
          {e.fixLabel}
        </Button>
      ) : null}
    </div>
  )
}
