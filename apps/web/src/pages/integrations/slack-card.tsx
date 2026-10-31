import { useState, type FormEvent } from 'react'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { LEAD_PRIORITIES, slackSettingsSchema, type IntegrationsStatus, type LeadPriority } from '@leadpilot/shared'
import { useDeleteSlack, useSaveSlack, useTestSlack } from '@/api'
import {
  ConfirmDialog,
  FormField,
  PriorityBadge,
  ReadOnlyGuard,
  RelativeTime,
  StatusBadge,
  useMutationGuard,
} from '@/components/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/api-client'
import { formatEnumLabel } from '@/lib/format'
import { DetailList, IntegrationCard } from './parts'

type Slack = IntegrationsStatus['slack']

const PRIORITY_ITEMS = LEAD_PRIORITIES.map((p) => ({ value: p, label: `${formatEnumLabel(p)} and above` }))

export function SlackCard({ slack }: { slack: Slack }) {
  const status = !slack.configured ? (
    <StatusBadge tone="neutral">Not connected</StatusBadge>
  ) : slack.enabled ? (
    <StatusBadge tone="success">Enabled</StatusBadge>
  ) : (
    <StatusBadge tone="warning">Paused</StatusBadge>
  )
  const delivery = slack.lastDelivery

  return (
    <IntegrationCard
      icon={MessageSquare}
      title="Slack"
      description="Posts an alert to a channel when a qualified lead reaches the minimum priority."
      status={status}
    >
      <DetailList
        items={[
          { label: 'Webhook', value: slack.webhookHint ? <code className="font-mono text-xs">{slack.webhookHint}</code> : '—' },
          { label: 'Channel', value: slack.channelLabel || '—' },
          { label: 'Minimum priority', value: <PriorityBadge priority={slack.minPriority} /> },
          {
            label: 'Last delivery',
            value: delivery ? (
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={delivery.status === 'sent' ? 'success' : delivery.status === 'failed' ? 'danger' : 'neutral'}>
                  {formatEnumLabel(delivery.status)}
                </StatusBadge>
                <RelativeTime value={delivery.createdAt} />
                {delivery.error ? <span className="block w-full text-xs text-danger">{delivery.error}</span> : null}
              </span>
            ) : (
              <span className="text-muted-foreground">No deliveries yet</span>
            ),
          },
        ]}
      />
      <SlackForm slack={slack} key={`${slack.configured}-${slack.enabled}-${slack.minPriority}-${slack.channelLabel ?? ''}`} />
    </IntegrationCard>
  )
}

function SlackForm({ slack }: { slack: Slack }) {
  const guard = useMutationGuard({ action: 'configure Slack', minRole: 'admin' })
  const save = useSaveSlack()
  const test = useTestSlack()
  const remove = useDeleteSlack()
  const [webhookUrl, setWebhookUrl] = useState('')
  const [channelLabel, setChannelLabel] = useState(slack.channelLabel ?? '')
  const [minPriority, setMinPriority] = useState<LeadPriority>(slack.minPriority)
  const [enabled, setEnabled] = useState(slack.configured ? slack.enabled : true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmRemove, setConfirmRemove] = useState(false)
  const disabled = !guard.allowed || save.isPending

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!slack.configured && !webhookUrl.trim()) {
      setErrors({ webhookUrl: 'A webhook URL is required to connect Slack' })
      return
    }
    const parsed = slackSettingsSchema.safeParse({
      webhookUrl: webhookUrl.trim() || undefined,
      enabled,
      minPriority,
      channelLabel: channelLabel.trim() || null,
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message
      setErrors(next)
      return
    }
    setErrors({})
    save.mutate(parsed.data, {
      onSuccess: () => {
        setWebhookUrl('')
        toast.success(slack.configured ? 'Slack settings saved' : 'Slack connected')
      },
      onError: (err) => {
        setErrors(err.fieldErrors)
        toast.error(errorMessage(err))
      },
    })
  }

  function sendTest() {
    test.mutate(undefined, {
      onSuccess: () => toast.success('Test message sent to Slack'),
      onError: (err) => toast.error(`Slack test failed: ${errorMessage(err)}`),
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 border-t pt-4" noValidate>
      {!guard.allowed ? <p className="text-xs text-muted-foreground">{guard.reason}. Settings are shown read-only.</p> : null}
      <FormField
        label="Incoming webhook URL"
        error={errors.webhookUrl}
        description={
          slack.configured
            ? 'Leave blank to keep the current webhook. The URL is encrypted on the server and never displayed again.'
            : 'Create an incoming webhook in Slack. The URL is encrypted on the server and never displayed again.'
        }
      >
        <Input
          type="password"
          autoComplete="off"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder={slack.webhookHint ? `Current: ${slack.webhookHint}` : 'https://hooks.slack.com/services/…'}
          disabled={disabled}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Channel label" error={errors.channelLabel} description="For your reference, e.g. #sales-leads.">
          <Input value={channelLabel} onChange={(e) => setChannelLabel(e.target.value)} maxLength={80} disabled={disabled} />
        </FormField>
        <FormField label="Minimum priority" error={errors.minPriority}>
          <Select
            items={PRIORITY_ITEMS}
            value={minPriority}
            onValueChange={(v) => v && setMinPriority(v as LeadPriority)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="slack-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v)} disabled={disabled} />
        <Label htmlFor="slack-enabled" className="text-[13px] font-normal">
          Send alerts
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReadOnlyGuard action="configure Slack" minRole="admin">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {slack.configured ? 'Save changes' : 'Connect Slack'}
          </Button>
        </ReadOnlyGuard>
        <ReadOnlyGuard
          action="send a Slack test"
          minRole="admin"
          disabledReason={!slack.configured ? 'Connect Slack first' : null}
        >
          <Button type="button" variant="outline" size="sm" onClick={sendTest} disabled={test.isPending}>
            <Send aria-hidden="true" />
            {test.isPending ? 'Sending…' : 'Send test message'}
          </Button>
        </ReadOnlyGuard>
        {slack.configured ? (
          <ReadOnlyGuard action="remove Slack" minRole="admin" className="sm:ml-auto">
            <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmRemove(true)}>
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          </ReadOnlyGuard>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove Slack integration?"
        description="The stored webhook URL is deleted and alerts stop immediately. You will need the URL again to reconnect."
        confirmLabel="Remove"
        destructive
        onConfirm={() =>
          remove.mutateAsync(undefined).then(
            () => toast.success('Slack removed'),
            (err: unknown) => {
              toast.error(errorMessage(err))
              throw err
            },
          )
        }
      />
    </form>
  )
}
