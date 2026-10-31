import { useIntegrations } from '@/api'
import { ErrorState, PageHeader } from '@/components/app'
import { AiCard } from './ai-card'
import { EmailCard, N8nCard } from './automation-cards'
import { IntakeCard } from './intake-card'
import { CardSkeleton } from './parts'
import { SlackCard } from './slack-card'

export function IntegrationsPage() {
  const integrations = useIntegrations()

  return (
    <div className="space-y-6">
      <PageHeader title="Integrations" description="Gemini, Slack, the intake webhook and n8n connection status." />
      {integrations.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading integrations">
          <div className="lg:col-span-2">
            <CardSkeleton rows={6} />
          </div>
          <CardSkeleton rows={5} />
          <CardSkeleton rows={5} />
          <CardSkeleton rows={3} />
          <CardSkeleton rows={2} />
        </div>
      ) : integrations.isError ? (
        <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} retrying={integrations.isFetching} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <AiCard ai={integrations.data.ai} />
          <SlackCard slack={integrations.data.slack} />
          <IntakeCard intake={integrations.data.intake} />
          <N8nCard n8n={integrations.data.n8n} />
          <EmailCard />
        </div>
      )}
    </div>
  )
}
