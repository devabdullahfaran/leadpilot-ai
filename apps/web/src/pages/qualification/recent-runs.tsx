import { Link, useNavigate } from 'react-router'
import { History } from 'lucide-react'
import { useExecutions } from '@/api'
import { useAppLink } from '@/app/data-mode'
import { EmptyState, ErrorState } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ExecutionsTable, ExecutionsTableSkeleton } from '../workflows/executions-table'

export function RecentRunsSection() {
  const link = useAppLink()
  const navigate = useNavigate()
  const runs = useExecutions({ workflowKey: 'lead_qualification', pageSize: 10 })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent AI runs</CardTitle>
        <CardDescription>The latest qualification executions, from manual runs, retries and n8n write-backs.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" render={<Link to={link('/workflows?workflow=lead_qualification')} />} nativeButton={false}>
            All runs
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {runs.isPending ? (
          <ExecutionsTableSkeleton rows={5} />
        ) : runs.isError ? (
          <ErrorState size="compact" error={runs.error} onRetry={() => void runs.refetch()} retrying={runs.isFetching} />
        ) : runs.data.data.length === 0 ? (
          <EmptyState
            size="compact"
            icon={History}
            title="No AI runs yet"
            description="Runs appear here when a lead is qualified — from the intake webhook, the Run AI button above, or n8n."
          />
        ) : (
          <ExecutionsTable
            executions={runs.data.data}
            compact
            onSelect={(id) => void navigate(link(`/workflows?execution=${id}`))}
          />
        )}
      </CardContent>
    </Card>
  )
}
