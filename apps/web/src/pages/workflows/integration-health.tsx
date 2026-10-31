import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useIntegrations } from '@/api'
import { useAppLink } from '@/app/data-mode'
import { ErrorState, ExecutionStatusBadge, RelativeTime, StatusBadge, type Tone } from '@/components/app'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { aiAvailability } from '../qualification/ai-availability'

interface HealthItem {
  name: string
  tone: Tone
  status: string
  detail: ReactNode
}

export function IntegrationHealth() {
  const link = useAppLink()
  const integrations = useIntegrations()

  if (integrations.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading integration health">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    )
  }
  if (integrations.isError) {
    return <ErrorState size="compact" error={integrations.error} onRetry={() => void integrations.refetch()} retrying={integrations.isFetching} />
  }

  const { ai, slack, intake, n8n } = integrations.data
  const availability = aiAvailability(ai)
  const aiStatus: Record<string, [Tone, string]> = {
    not_configured: ['neutral', 'Not configured'],
    globally_disabled: ['warning', 'Off on server'],
    workspace_disabled: ['warning', 'Disabled'],
    quota_exhausted: ['warning', 'Quota used up'],
  }
  const [aiTone, aiLabel] = availability.available ? (['success', 'Available'] as [Tone, string]) : aiStatus[availability.reason]

  const items: HealthItem[] = [
    {
      name: `Gemini · ${ai.model}`,
      tone: aiTone,
      status: aiLabel,
      detail: ai.lastErrorAt && (!ai.lastSuccessAt || ai.lastErrorAt > ai.lastSuccessAt) ? (
        <span>
          Last error <RelativeTime value={ai.lastErrorAt} />
        </span>
      ) : (
        <span>
          Last success <RelativeTime value={ai.lastSuccessAt} />
        </span>
      ),
    },
    {
      name: 'Slack',
      tone: !slack.configured ? 'neutral' : !slack.enabled ? 'warning' : slack.lastDelivery?.status === 'failed' ? 'danger' : 'success',
      status: !slack.configured ? 'Not configured' : !slack.enabled ? 'Paused' : slack.lastDelivery?.status === 'failed' ? 'Last delivery failed' : 'Enabled',
      detail: slack.lastDelivery ? (
        <span>
          Last delivery <RelativeTime value={slack.lastDelivery.createdAt} />
        </span>
      ) : (
        <span>No deliveries yet</span>
      ),
    },
    {
      name: 'Intake webhook',
      tone: intake.configured ? 'success' : 'neutral',
      status: intake.configured ? 'Key active' : 'No key',
      detail: intake.lastReceivedAt ? (
        <span>
          Last submission <RelativeTime value={intake.lastReceivedAt} />
        </span>
      ) : (
        <span>No submissions received</span>
      ),
    },
    {
      name: 'n8n (self-hosted)',
      tone: n8n.lastExecutionAt ? 'info' : 'neutral',
      status: n8n.lastExecutionAt ? `${formatNumber(n8n.executionsLast7Days)} runs in 7 days` : 'No write-backs',
      detail: n8n.lastExecutionAt ? (
        <span className="flex flex-wrap items-center gap-1.5">
          Last write-back <RelativeTime value={n8n.lastExecutionAt} />
          {n8n.lastStatus ? <ExecutionStatusBadge status={n8n.lastStatus} /> : null}
        </span>
      ) : (
        <span>n8n runs on your own server and only appears here when it writes executions back.</span>
      ),
    },
  ]

  return (
    <section aria-labelledby="integration-health-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="integration-health-heading" className="text-sm font-medium">
          Integration health
        </h2>
        <Link to={link('/integrations')} className="text-[13px] text-primary hover:underline">
          Manage integrations
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <Card key={item.name} size="sm">
            <CardContent className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{item.name}</span>
                <StatusBadge tone={item.tone} variant="dot">
                  {item.status}
                </StatusBadge>
              </div>
              <div className="text-xs text-muted-foreground">{item.detail}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
