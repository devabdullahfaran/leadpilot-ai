import { useState } from 'react'
import { KeyRound, TriangleAlert, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import type { IntegrationsStatus } from '@leadpilot/shared'
import { useRotateIntakeKey, type IntakeKeyResult } from '@/api'
import { ConfirmDialog, CopyButton, ReadOnlyGuard, RelativeTime, StatusBadge } from '@/components/app'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/lib/api-client'
import { CodeBlock, DetailList, IntegrationCard } from './parts'
import { curlSnippet, htmlSnippet } from './snippets'

export function IntakeCard({ intake }: { intake: IntegrationsStatus['intake'] }) {
  const rotate = useRotateIntakeKey()
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [newKey, setNewKey] = useState<IntakeKeyResult | null>(null)

  function generate() {
    return rotate.mutateAsync(undefined).then(
      (result) => {
        setNewKey(result)
        toast.success(intake.configured ? 'Intake key rotated' : 'Intake key created')
      },
      (err: unknown) => {
        toast.error(errorMessage(err))
        throw err
      },
    )
  }

  const curl = curlSnippet(intake.endpoint)
  const html = htmlSnippet(intake.endpoint)

  return (
    <IntegrationCard
      icon={Webhook}
      title="Webhook intake"
      description="Receive leads from website forms, landing pages, n8n or any HTTP client."
      status={
        intake.configured ? <StatusBadge tone="success">Key active</StatusBadge> : <StatusBadge tone="neutral">No key</StatusBadge>
      }
    >
      <DetailList
        items={[
          {
            label: 'Endpoint',
            value: (
              <span className="flex min-w-0 items-center gap-1">
                <code className="min-w-0 truncate font-mono text-xs" title={intake.endpoint}>
                  POST {intake.endpoint}
                </code>
                <CopyButton value={intake.endpoint} label="Copy endpoint URL" />
              </span>
            ),
          },
          {
            label: 'Intake key',
            value: intake.keyPrefix ? <code className="font-mono text-xs">{intake.keyPrefix}…</code> : 'Not configured',
          },
          { label: 'Last received', value: <RelativeTime value={intake.lastReceivedAt} /> },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ReadOnlyGuard action={intake.configured ? 'rotate the intake key' : 'generate an intake key'} minRole="admin">
          <Button
            size="sm"
            variant={intake.configured ? 'outline' : 'default'}
            disabled={rotate.isPending}
            onClick={() => (intake.configured ? setConfirmRotate(true) : void generate().catch(() => undefined))}
          >
            <KeyRound aria-hidden="true" />
            {intake.configured ? 'Rotate key' : 'Generate key'}
          </Button>
        </ReadOnlyGuard>
        <p className="text-xs text-muted-foreground">Keys are stored as a hash; the full key is shown only once.</p>
      </div>

      <Tabs defaultValue="curl" className="gap-2 border-t pt-4">
        <TabsList>
          <TabsTrigger value="curl">curl</TabsTrigger>
          <TabsTrigger value="html">HTML form + fetch</TabsTrigger>
        </TabsList>
        <TabsContent value="curl">
          <CodeBlock code={curl} label="curl example" copy={<CopyButton value={curl} label="Copy curl example" />} />
        </TabsContent>
        <TabsContent value="html">
          <CodeBlock code={html} label="HTML form example" copy={<CopyButton value={html} label="Copy HTML example" />} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Rotate the intake key?"
        description="The current key stops working immediately. Forms and n8n workflows using it will be rejected until you update them with the new key."
        confirmLabel="Rotate key"
        destructive
        onConfirm={generate}
      />
      <Dialog open={newKey !== null} onOpenChange={(open) => (!open ? setNewKey(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new intake key</DialogTitle>
            <DialogDescription>Send it in the X-Intake-Key header with every request to the intake endpoint.</DialogDescription>
          </DialogHeader>
          {newKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
                <code className="min-w-0 flex-1 font-mono text-xs break-all">{newKey.key}</code>
                <CopyButton value={newKey.key} label="Copy intake key" variant="outline" size="icon-sm" />
              </div>
              <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs">
                <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                Copy it now. It will not be shown again; if you lose it, rotate the key.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>I have copied the key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </IntegrationCard>
  )
}
