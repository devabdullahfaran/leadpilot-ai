import { Mail, Workflow } from 'lucide-react'
import type { IntegrationsStatus } from '@leadpilot/shared'
import { ExecutionStatusBadge, RelativeTime, StatusBadge } from '@/components/app'
import { formatNumber } from '@/lib/format'
import { DetailList, IntegrationCard } from './parts'

const DOCS_PATH = 'docs/N8N.md'
const WORKFLOW_FILE = 'n8n/leadpilot-lead-qualification.workflow.json'

export function N8nCard({ n8n }: { n8n: IntegrationsStatus['n8n'] }) {
  return (
    <IntegrationCard
      icon={Workflow}
      title="n8n automation"
      description="Runs on your own n8n instance. The hosted app does not depend on it."
      status={<StatusBadge tone="neutral">Self-hosted</StatusBadge>}
    >
      <DetailList
        items={[
          {
            label: 'Last execution',
            value: n8n.lastExecutionAt ? <RelativeTime value={n8n.lastExecutionAt} /> : <span className="text-muted-foreground">None reported</span>,
          },
          { label: 'Last status', value: n8n.lastStatus ? <ExecutionStatusBadge status={n8n.lastStatus} /> : '—' },
          { label: 'Executions (7 days)', value: <span className="tabular-nums">{formatNumber(n8n.executionsLast7Days)}</span> },
        ]}
      />
      <p className="text-[13px] text-muted-foreground">
        Only executions that your n8n workflow reports back are shown. Import{' '}
        <code className="font-mono text-xs">{WORKFLOW_FILE}</code> into n8n and follow{' '}
        <code className="font-mono text-xs">{DOCS_PATH}</code> in the GitHub repository for setup.
      </p>
    </IntegrationCard>
  )
}

export function EmailCard() {
  return (
    <IntegrationCard
      icon={Mail}
      title="Email follow-up"
      description="Optional, through n8n. The hosted app does not send email."
      status={<StatusBadge tone="neutral">Via n8n</StatusBadge>}
    >
      <p className="text-[13px] text-muted-foreground">
        Follow-up emails are available through the optional Send Email node in the n8n workflow, using your own SMTP
        credentials configured in n8n. There is nothing to switch on here.
      </p>
    </IntegrationCard>
  )
}
