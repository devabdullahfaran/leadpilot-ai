import { Link } from 'react-router'
import { BellRing, Bot, ChevronRight, CircleAlert, Copy, Database, ShieldCheck } from 'lucide-react'
import { useIntegrations } from '@/api'
import { useAppLink } from '@/app/data-mode'
import { ErrorState, StatusBadge, type Tone } from '@/components/app'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { aiAvailability } from './ai-availability'

// Static description of the Worker's steps (not run data).
const STEPS = [
  { key: 'validate', label: 'Validate', icon: ShieldCheck, detail: 'Schema check and normalisation' },
  { key: 'deduplicate', label: 'Deduplicate', icon: Copy, detail: 'Match on email, phone, company' },
  { key: 'ai_classify', label: 'AI classify', icon: Bot, detail: 'Gemini scores against the rubric' },
  { key: 'persist', label: 'Persist', icon: Database, detail: 'Score, priority and history saved' },
  { key: 'notify_slack', label: 'Slack alert', icon: BellRing, detail: 'Sent when priority meets the minimum' },
] as const

const UNAVAILABLE_COPY = {
  not_configured: {
    title: 'AI provider not configured',
    body: 'The server has no Gemini API key. New leads are stored but not scored; you can still qualify them manually from the lead page.',
    path: '/integrations',
    cta: 'View integrations',
  },
  globally_disabled: {
    title: 'AI is switched off on the server',
    body: 'The global AI switch is off, so no model calls are made for any workspace.',
    path: '/integrations',
    cta: 'View integrations',
  },
  workspace_disabled: {
    title: 'AI qualification is disabled for this workspace',
    body: 'Turn it on in AI settings to score leads automatically and on demand.',
    path: '/settings',
    cta: 'Open AI settings',
  },
  quota_exhausted: {
    title: 'Today’s AI quota is used up',
    body: 'Runs are refused until the quota resets at UTC midnight. Leads submitted meanwhile are stored without a score.',
    path: '/integrations',
    cta: 'View usage',
  },
} as const

export function PipelineSection() {
  const link = useAppLink()
  const integrations = useIntegrations()
  const ai = integrations.data?.ai
  const availability = ai ? aiAvailability(ai) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Qualification pipeline</CardTitle>
        <CardDescription>The steps the Worker runs for every lead. This diagram explains the process; it is not live run data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="grid gap-2 sm:grid-cols-5" aria-label="Pipeline steps">
          {STEPS.map((step, i) => (
            <li key={step.key} className="relative flex items-start gap-2 rounded-lg border bg-background p-3 sm:flex-col">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <step.icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">
                  <span className="text-muted-foreground tabular-nums">{i + 1}. </span>
                  {step.label}
                </span>
                <span className="block text-xs text-muted-foreground">{step.detail}</span>
              </span>
              {i < STEPS.length - 1 ? (
                <ChevronRight aria-hidden="true" className="absolute top-1/2 -right-2.5 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-background text-muted-foreground sm:block" />
              ) : null}
            </li>
          ))}
        </ol>

        {integrations.isPending ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-28" />
            ))}
          </div>
        ) : integrations.isError ? (
          <ErrorState size="compact" error={integrations.error} title="Couldn’t load AI status" onRetry={() => void integrations.refetch()} retrying={integrations.isFetching} />
        ) : ai ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="AI status">
            <Chip tone={ai.configured ? 'success' : 'danger'} label="Provider" value={ai.configured ? 'Gemini configured' : 'Not configured'} />
            <Chip tone="neutral" label="Model" value={<code className="font-mono text-[11px]">{ai.model}</code>} />
            <Chip tone={ai.globallyEnabled ? 'success' : 'warning'} label="Global switch" value={ai.globallyEnabled ? 'On' : 'Off'} />
            <Chip tone={ai.workspaceEnabled ? 'success' : 'warning'} label="Workspace" value={ai.workspaceEnabled ? 'Enabled' : 'Disabled'} />
            <Chip
              tone={ai.usage.todayWorkspace >= ai.usage.workspaceDailyLimit ? 'danger' : 'neutral'}
              label="Today’s quota"
              value={
                <span className="tabular-nums">
                  {formatNumber(ai.usage.todayWorkspace)} / {formatNumber(ai.usage.workspaceDailyLimit)}
                </span>
              }
            />
          </div>
        ) : null}

        {availability && !availability.available ? (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{UNAVAILABLE_COPY[availability.reason].title}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{UNAVAILABLE_COPY[availability.reason].body}</p>
              <Button variant="outline" size="sm" render={<Link to={link(UNAVAILABLE_COPY[availability.reason].path)} />}>
                {UNAVAILABLE_COPY[availability.reason].cta}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Chip({ tone, label, value }: { tone: Tone; label: string; value: React.ReactNode }) {
  return (
    <StatusBadge tone={tone}>
      <span className="opacity-80">{label}:</span> {value}
    </StatusBadge>
  )
}
