import type { UseQueryResult } from '@tanstack/react-query'
import type { AiSettings } from '@leadpilot/shared'
import { Link } from 'react-router'
import { Pencil } from 'lucide-react'
import { useAppLink } from '@/app/data-mode'
import { ErrorState, ReadOnlyGuard } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatEnumLabel, formatPercent } from '@/lib/format'

export function RubricSection({ query }: { query: UseQueryResult<AiSettings> }) {
  const link = useAppLink()
  const settings = query.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring rubric in use</CardTitle>
        <CardDescription>The criteria and thresholds sent to the model and applied to its output for this workspace.</CardDescription>
        <CardAction>
          <ReadOnlyGuard action="edit the scoring rubric" minRole="admin">
            <Button variant="outline" size="sm" render={<Link to={link('/settings')} />} nativeButton={false}>
              <Pencil aria-hidden="true" />
              Edit in Settings
            </Button>
          </ReadOnlyGuard>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading rubric">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState size="compact" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : settings ? (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Criterion</TableHead>
                    <TableHead className="text-right">Max points</TableHead>
                    <TableHead className="hidden sm:table-cell">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settings.criteria.map((c) => (
                    <TableRow key={c.key}>
                      <TableCell className="font-medium">
                        {c.label}
                        <span className="block text-xs font-normal text-muted-foreground sm:hidden">{c.description}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.maxPoints}</TableCell>
                      <TableCell className="hidden whitespace-normal text-muted-foreground sm:table-cell">{c.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
              <Stat label="High priority" value={`Score ≥ ${settings.thresholds.high}`} />
              <Stat label="Medium priority" value={`Score ≥ ${settings.thresholds.medium}`} />
              <Stat label="Flag for review below" value={`${formatPercent(settings.reviewConfidence)} confidence`} />
            </dl>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Categories</p>
              <ul className="flex flex-wrap gap-1.5">
                {settings.categories.map((c) => (
                  <li key={c} className="rounded-md border px-1.5 py-0.5 text-xs">
                    {formatEnumLabel(c)}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
