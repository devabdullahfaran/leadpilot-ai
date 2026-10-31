import { useState, type FormEvent } from 'react'
import {
  ArrowRightLeft,
  Bell,
  BellOff,
  CircleX,
  Copy,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  Sparkles,
  UserCog,
  UserPen,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ActivityType, LeadActivity } from '@leadpilot/shared'
import { useAddNote, useLeadActivities } from '@/api'
import { ErrorState, ReadOnlyGuard, RelativeTime, SampleBadge, useMutationGuard } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api-client'
import { formatEnumLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

const ICONS: Record<ActivityType, LucideIcon> = {
  lead_created: Plus,
  lead_updated: Pencil,
  status_changed: ArrowRightLeft,
  owner_changed: UserCog,
  note_added: MessageSquare,
  qualification_started: Sparkles,
  qualification_completed: Sparkles,
  qualification_failed: CircleX,
  qualification_override: UserPen,
  duplicate_submission: Copy,
  notification_sent: Bell,
  notification_failed: BellOff,
}

const DANGER: ActivityType[] = ['qualification_failed', 'notification_failed']

type Filter = 'all' | 'notes' | 'system'

export function ActivityTimeline({ leadId }: { leadId: string }) {
  const activities = useLeadActivities(leadId)
  const [filter, setFilter] = useState<Filter>('all')
  const items = (activities.data ?? []).filter((a) =>
    filter === 'all' ? true : filter === 'notes' ? a.type === 'note_added' : a.type !== 'note_added',
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Communication &amp; notes</CardTitle>
        <CardDescription>Notes and system events, newest first</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <NoteComposer leadId={leadId} />
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList aria-label="Filter activity">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
        </Tabs>
        {activities.isPending ? (
          <div className="space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.error ? (
          <ErrorState error={activities.error} size="compact" onRetry={() => void activities.refetch()} />
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {filter === 'notes' ? 'No notes yet. Add the first one above.' : 'No activity recorded yet.'}
          </p>
        ) : (
          <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-3.5 before:w-px before:bg-border">
            {items.map((a) => (
              <ActivityItem key={a.id} activity={a} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityItem({ activity }: { activity: LeadActivity }) {
  const Icon = ICONS[activity.type] ?? Pencil
  const isNote = activity.type === 'note_added'
  return (
    <li className="relative flex gap-3">
      <span
        className={cn(
          'z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background',
          DANGER.includes(activity.type) ? 'text-danger' : isNote ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span className="font-medium">{formatEnumLabel(activity.type)}</span>
          {activity.isSample ? <SampleBadge /> : null}
        </p>
        {activity.body ? (
          <p className={cn('mt-0.5 break-words whitespace-pre-line', isNote ? 'rounded-md bg-muted/60 p-2' : 'text-muted-foreground')}>
            {activity.body}
          </p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {activity.actor?.fullName ?? (activity.actor ? 'Member' : 'System')} · <RelativeTime value={activity.createdAt} />
        </p>
      </div>
    </li>
  )
}

function NoteComposer({ leadId }: { leadId: string }) {
  const addNote = useAddNote()
  const guard = useMutationGuard({ action: 'add notes', minRole: 'member' })
  const [body, setBody] = useState('')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const text = body.trim()
    if (!text) return
    try {
      await addNote.mutateAsync({ leadId, body: text })
      setBody('')
      toast.success('Note added')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Textarea
        aria-label="New note"
        rows={2}
        maxLength={4000}
        placeholder={guard.allowed ? 'Add a note about a call, email or meeting…' : (guard.reason ?? 'Read-only')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!guard.allowed || addNote.isPending}
      />
      <div className="flex justify-end">
        <ReadOnlyGuard action="add notes" minRole="member">
          <Button type="submit" size="sm" disabled={!body.trim() || addNote.isPending}>
            {addNote.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Add note
          </Button>
        </ReadOnlyGuard>
      </div>
    </form>
  )
}
