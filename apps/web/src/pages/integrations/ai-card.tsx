import { Link } from 'react-router'
import { Sparkles } from 'lucide-react'
import type { AiUsageStatus, IntegrationsStatus } from '@leadpilot/shared'
import { useAiUsage } from '@/api'
import { useAppLink } from '@/app/data-mode'
import { EmptyState, ErrorState, RelativeTime, StatusBadge, type Tone } from '@/components/app'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDuration, formatEnumLabel, formatNumber } from '@/lib/format'
import { DetailList, IntegrationCard } from './parts'

const USAGE_TONE: Record<AiUsageStatus, Tone> = {
  success: 'success',
  invalid_response: 'warning',
  error: 'danger',
  timeout: 'danger',
  rejected_quota: 'neutral',
  rejected_disabled: 'neutral',
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {formatNumber(used)} / {formatNumber(limit)}
        </span>
      </div>
      <Progress value={pct} aria-label={`${label}: ${used} of ${limit} calls used`} />
    </div>
  )
}

export function AiCard({ ai }: { ai: IntegrationsStatus['ai'] }) {
  const link = useAppLink()
  const status = !ai.configured ? (
    <StatusBadge tone="warning">Not configured</StatusBadge>
  ) : !ai.globallyEnabled ? (
    <StatusBadge tone="neutral">Disabled by operator</StatusBadge>
  ) : !ai.workspaceEnabled ? (
    <StatusBadge tone="neutral">Off for this workspace</StatusBadge>
  ) : (
    <StatusBadge tone="success">Active</StatusBadge>
  )

  return (
    <IntegrationCard
      icon={Sparkles}
      title="Google Gemini"
      description="Scores and classifies incoming leads. Results are AI-generated estimates that your team can review and override."
      status={status}
      className="lg:col-span-2"
    >
      {!ai.configured ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[13px]">
          The server has no Gemini API key. The operator must set <code className="font-mono">GEMINI_API_KEY</code> as a
          Cloudflare Worker secret (see docs/SETUP-KEYS.md). Keys are never entered in the browser. Until then, leads are
          stored without AI qualification.
        </p>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        <DetailList
          items={[
            { label: 'API key', value: ai.configured ? 'Present on the server (never shown)' : 'Missing' },
            { label: 'Model', value: <code className="font-mono text-xs">{ai.model}</code> },
            { label: 'Global AI switch', value: ai.globallyEnabled ? 'On' : 'Off (AI_ENABLED server variable)' },
            {
              label: 'Workspace setting',
              value: (
                <span>
                  {ai.workspaceEnabled ? 'Enabled' : 'Disabled'} ·{' '}
                  <Link to={link('/settings?tab=ai')} className="text-primary underline-offset-4 hover:underline">
                    AI settings
                  </Link>
                </span>
              ),
            },
            { label: 'Last success', value: <RelativeTime value={ai.lastSuccessAt} /> },
            {
              label: 'Last error',
              value: ai.lastErrorAt ? (
                <span className="space-y-0.5">
                  <RelativeTime value={ai.lastErrorAt} />
                  {ai.lastError ? <span className="block text-xs text-danger">{ai.lastError}</span> : null}
                </span>
              ) : (
                <span className="text-muted-foreground">None recorded</span>
              ),
            },
          ]}
        />
        <div className="space-y-4">
          <QuotaBar label="Workspace calls today" used={ai.usage.todayWorkspace} limit={ai.usage.workspaceDailyLimit} />
          {ai.usage.globalDailyLimit > 0 ? (
            <QuotaBar label="All workspaces today" used={ai.usage.todayGlobal} limit={ai.usage.globalDailyLimit} />
          ) : null}
          <p className="text-xs text-muted-foreground">Daily limits reset at midnight UTC. Calls over the limit are rejected, not queued.</p>
        </div>
      </div>
      <AiUsageTable />
    </IntegrationCard>
  )
}

function AiUsageTable() {
  const usage = useAiUsage()
  return (
    <section aria-labelledby="ai-usage-heading" className="space-y-2 border-t pt-4">
      <h3 id="ai-usage-heading" className="text-[13px] font-medium">
        Recent AI requests
      </h3>
      {usage.isPending ? (
        <div className="space-y-2" aria-label="Loading AI requests">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : usage.isError ? (
        <ErrorState error={usage.error} size="compact" onRetry={() => void usage.refetch()} retrying={usage.isFetching} />
      ) : usage.data.length === 0 ? (
        <EmptyState
          size="compact"
          title="No AI requests yet"
          description="Requests appear here when a lead is qualified, either on intake or with “Qualify” on a lead."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Tokens (in / out)</TableHead>
                <TableHead>Error code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <RelativeTime value={e.createdAt} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.model}</TableCell>
                  <TableCell>
                    <StatusBadge tone={USAGE_TONE[e.status]}>{formatEnumLabel(e.status)}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(e.latencyMs)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(e.promptTokens)} / {formatNumber(e.outputTokens)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.errorCode ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
