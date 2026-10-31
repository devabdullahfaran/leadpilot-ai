import { CircleX, Clock, LoaderCircle, RefreshCw, Sparkles, TriangleAlert, UserPen, Ban } from 'lucide-react'
import {
  DEFAULT_PRIORITY_THRESHOLDS,
  clampScore,
  priorityFromScore,
  type AiSettings,
  type Lead,
  type LeadQualification,
} from '@leadpilot/shared'
import { AiDisclaimer, ErrorState, PriorityBadge, ReadOnlyGuard, RelativeTime, SampleBadge } from '@/components/app'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatEnumLabel, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { reviewReason } from './lib'

const RING = { high: 'text-success', medium: 'text-warning', low: 'text-muted-foreground' } as const

function ScoreRing({ score, settings }: { score: number; settings?: AiSettings }) {
  const value = clampScore(score)
  const band = priorityFromScore(value, settings?.thresholds ?? DEFAULT_PRIORITY_THRESHOLDS)
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <div className="relative size-24 shrink-0" role="meter" aria-label="Lead score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          className={RING[band]}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-[11px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

interface QualificationCardProps {
  lead: Lead
  latest: LeadQualification | undefined
  historyLoading: boolean
  settings?: AiSettings
  running: boolean
  onRun: () => void
}

export function QualificationCard({ lead, latest, historyLoading, settings, running, onRun }: QualificationCardProps) {
  const status = running ? 'processing' : lead.qualificationStatus
  const retry = (label: string) => (
    <ReadOnlyGuard action="run AI qualification" minRole="member">
      <Button variant="outline" size="sm" onClick={onRun} disabled={running}>
        <RefreshCw aria-hidden="true" />
        {label}
      </Button>
    </ReadOnlyGuard>
  )

  let body: React.ReactNode
  if (status === 'processing') {
    body = (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm" aria-live="polite">
        <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium">AI qualification in progress</p>
          <p className="text-muted-foreground">Scoring the inquiry against your criteria. This usually takes a few seconds.</p>
        </div>
      </div>
    )
  } else if (status === 'pending') {
    body = (
      <StateBox icon={Clock} title="Not qualified yet" text="This lead has not been scored by AI. Run a qualification or set the score manually." action={retry('Run AI qualification')} />
    )
  } else if (status === 'failed' && lead.score === null) {
    body = (
      <StateBox icon={CircleX} tone="danger" title="AI qualification failed" text={lead.qualificationError ?? 'The last AI run did not produce a result.'} action={retry('Retry')} />
    )
  } else if (status === 'skipped' && lead.score === null) {
    body = (
      <StateBox icon={Ban} title="Qualification skipped" text={lead.qualificationError ?? 'AI qualification was not run for this lead (AI disabled or quota reached at intake).'} action={retry('Run AI qualification')} />
    )
  } else if (lead.score === null) {
    body = <StateBox icon={Clock} title="No score" text="No qualification result is stored for this lead." action={retry('Run AI qualification')} />
  } else {
    body = <Result lead={lead} latest={latest} historyLoading={historyLoading} settings={settings} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          AI qualification
        </CardTitle>
        <CardDescription>
          {lead.lastQualifiedAt ? (
            <>
              Last qualified <RelativeTime value={lead.lastQualifiedAt} />
            </>
          ) : (
            'Score, priority and recommended next step'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'needs_review' ? (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Needs human review</AlertTitle>
            <AlertDescription>{reviewReason(lead, latest, settings?.reviewConfidence)}</AlertDescription>
          </Alert>
        ) : null}
        {(status === 'failed' || status === 'skipped') && lead.score !== null ? (
          <Alert variant={status === 'failed' ? 'destructive' : 'default'}>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Latest run {status === 'failed' ? 'failed' : 'was skipped'}; showing the previous result</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {lead.qualificationError ?? 'No reason was recorded.'} {retry('Retry')}
            </AlertDescription>
          </Alert>
        ) : null}
        {body}
      </CardContent>
    </Card>
  )
}

function StateBox({ icon: Icon, title, text, action, tone }: { icon: typeof Clock; title: string; text: string; action: React.ReactNode; tone?: 'danger' }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center">
      <Icon className={cn('size-5 shrink-0', tone === 'danger' ? 'text-danger' : 'text-muted-foreground')} aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{text}</p>
      </div>
      {action}
    </div>
  )
}

function Result({ lead, latest, historyLoading, settings }: { lead: Lead; latest?: LeadQualification; historyLoading: boolean; settings?: AiSettings }) {
  const isManual = latest?.source === 'manual'
  const recommended = lead.recommendedAction ?? latest?.recommendedAction
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreRing score={lead.score ?? 0} settings={settings} />
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Priority</dt>
            <dd className="mt-1">
              <PriorityBadge priority={lead.priority} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Category</dt>
            <dd className="mt-1 font-medium">{lead.category ? formatEnumLabel(lead.category) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Confidence</dt>
            <dd className="mt-1 font-medium tabular-nums">{formatPercent(lead.confidence)}</dd>
          </div>
        </dl>
      </div>

      {recommended ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs font-medium text-primary">Recommended next step</p>
          <p className="mt-1 text-sm font-medium">{recommended}</p>
        </div>
      ) : null}

      {lead.aiSummary ?? latest?.summary ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Summary</p>
          <p className="mt-1 text-sm">{lead.aiSummary ?? latest?.summary}</p>
        </div>
      ) : null}

      {historyLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ) : latest ? (
        <>
          {latest.reasoning ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Reasoning</p>
              <p className="mt-1 text-sm whitespace-pre-line">{latest.reasoning}</p>
            </div>
          ) : null}
          {latest.criteria.length > 0 ? <CriteriaBreakdown qualification={latest} settings={settings} /> : null}
          {latest.adjustments.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Score adjustments</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {latest.adjustments.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            {isManual ? (
              <span className="flex items-center gap-1">
                <UserPen className="size-3.5" aria-hidden="true" />
                Manual override by {latest.createdBy?.fullName ?? 'a workspace member'}
                {latest.overrideReason ? <>: “{latest.overrideReason}”</> : null}
              </span>
            ) : (
              <span>
                Source: AI · model <span className="font-mono">{latest.model ?? '—'}</span> · prompt <span className="font-mono">{latest.promptVersion ?? '—'}</span>
              </span>
            )}
            {latest.isSample ? <SampleBadge /> : null}
          </div>
        </>
      ) : null}

      {!isManual ? <AiDisclaimer model={latest?.model} /> : null}
    </div>
  )
}

function CriteriaBreakdown({ qualification, settings }: { qualification: LeadQualification; settings?: AiSettings }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">Criteria breakdown</p>
      <ul className="mt-2 space-y-2.5">
        {qualification.criteria.map((item) => {
          const criterion = settings?.criteria.find((c) => c.key === item.key)
          const max = criterion?.maxPoints
          const ratio = max ? Math.min(1, Math.max(0, item.score / max)) : null
          return (
            <li key={item.key} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span>{criterion?.label ?? formatEnumLabel(item.key)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {item.score}
                  {max ? ` / ${max}` : ''}
                </span>
              </div>
              {ratio !== null ? (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
                </div>
              ) : null}
              {item.note ? <p className="mt-0.5 text-xs text-muted-foreground">{item.note}</p> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function QualificationHistory({ items, isPending, error, onRetry }: { items?: LeadQualification[]; isPending: boolean; error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Qualification history</CardTitle>
        <CardDescription>Every AI run and manual override, newest first</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} size="compact" onRetry={onRetry} />
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No qualifications yet. Run AI qualification or override the score to start the history.</p>
        ) : (
          <ul className="divide-y">
            {items.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <Badge variant={q.source === 'ai' ? 'secondary' : 'outline'}>{q.source === 'ai' ? 'AI' : 'Manual'}</Badge>
                <span className="font-medium tabular-nums">{q.score}</span>
                <PriorityBadge priority={q.priority} />
                {q.category ? <span className="text-muted-foreground">{formatEnumLabel(q.category)}</span> : null}
                {q.isSample ? <SampleBadge /> : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {q.source === 'manual' ? `${q.createdBy?.fullName ?? 'Member'} · ` : q.model ? `${q.model} · ` : ''}
                  <RelativeTime value={q.createdAt} />
                </span>
                {q.overrideReason ? <p className="w-full text-xs text-muted-foreground">Reason: {q.overrideReason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export { CardAction }
