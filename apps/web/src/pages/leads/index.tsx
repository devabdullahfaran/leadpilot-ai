import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, Plus, Search, Users, X } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  QUALIFICATION_STATUSES,
  type Lead,
  type SortableLeadField,
} from '@leadpilot/shared'
import { useAiSettings, useDeleteLead, useLeads, useMembers, type LeadListParams } from '@/api'
import { useAppLink } from '@/app/data-mode'
import {
  ConfirmDialog,
  DataPagination,
  EmptyState,
  ErrorState,
  LeadStatusBadge,
  PageHeader,
  PriorityBadge,
  QualificationStatusBadge,
  ReadOnlyGuard,
  SampleBadge,
  ScoreBar,
} from '@/components/app'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api-client'
import { formatEnumLabel, formatShortDate, formatDateTime } from '@/lib/format'
import { LeadFormDialog } from './lead-form-dialog'
import { PAGE_SIZES, enumOptions, memberLabel, parseEnum, useDebouncedValue, type Option } from './lib'
import { SimpleSelect } from './simple-select'

const ALL = 'all'
const UNASSIGNED = 'unassigned'
const SORTABLE: SortableLeadField[] = ['created_at', 'name', 'company', 'score', 'status']
const FILTER_KEYS = ['q', 'status', 'priority', 'qualificationStatus', 'source', 'ownerId'] as const

const withAll = (label: string, options: Option[]): Option[] => [{ value: ALL, label }, ...options]
const STATUS_FILTER = withAll('All statuses', enumOptions(LEAD_STATUSES))
const PRIORITY_FILTER = withAll('All priorities', enumOptions(LEAD_PRIORITIES))
const QUAL_FILTER = withAll('All qualification', enumOptions(QUALIFICATION_STATUSES))
const SOURCE_FILTER = withAll('All sources', enumOptions(LEAD_SOURCES))

function useListParams() {
  const [params, setParams] = useSearchParams()
  const pageSize = Number(params.get('pageSize'))
  const page = Number(params.get('page'))
  const owner = params.get('ownerId')
  const list: LeadListParams = {
    q: params.get('q')?.trim() || undefined,
    status: parseEnum(LEAD_STATUSES, params.get('status')),
    priority: parseEnum(LEAD_PRIORITIES, params.get('priority')),
    qualificationStatus: parseEnum(QUALIFICATION_STATUSES, params.get('qualificationStatus')),
    source: parseEnum(LEAD_SOURCES, params.get('source')),
    ownerId: owner || undefined,
    sort: parseEnum(SORTABLE, params.get('sort')) ?? 'created_at',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 25,
  }

  /** Updates params; any change other than `page` resets to page 1. */
  function update(patch: Record<string, string | number | null | undefined>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === undefined || value === '' || value === ALL) next.delete(key)
          else next.set(key, String(value))
        }
        if (!('page' in patch)) next.delete('page')
        return next
      },
      { replace: true },
    )
  }

  return { params, setParams, list, update }
}

export function LeadsPage() {
  const navigate = useNavigate()
  const link = useAppLink()
  const { params, setParams, list, update } = useListParams()
  const leads = useLeads(list)
  const members = useMembers()
  const aiSettings = useAiSettings()
  const thresholds = aiSettings.data?.thresholds
  const deleteLead = useDeleteLead()

  const [search, setSearch] = useState(list.q ?? '')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [editing, setEditing] = useState<Lead | null>(null)
  const [deleting, setDeleting] = useState<Lead | null>(null)
  const creating = params.get('new') === '1'

  useEffect(() => {
    if ((debouncedSearch.trim() || undefined) !== list.q) update({ q: debouncedSearch.trim() })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced input
  }, [debouncedSearch])

  // Keep the input in sync when the URL changes elsewhere (clear filters, back button).
  const urlQ = list.q ?? ''
  useEffect(() => {
    setSearch((current) => (current.trim() === urlQ ? current : urlQ))
  }, [urlQ])

  const ownerFilter = useMemo<Option[]>(
    () => [
      { value: ALL, label: 'All owners' },
      { value: UNASSIGNED, label: 'Unassigned' },
      ...(members.data ?? []).map((m) => ({ value: m.userId, label: memberLabel(m) })),
    ],
    [members.data],
  )

  const hasFilters = FILTER_KEYS.some((key) => params.has(key))
  const page = leads.data
  const rows = page?.data ?? []

  function setCreating(open: boolean) {
    update({ new: open ? '1' : null, page: list.page === 1 ? null : list.page })
  }

  function clearFilters() {
    setSearch('')
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        FILTER_KEYS.forEach((key) => next.delete(key))
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }

  function toggleSort(field: SortableLeadField) {
    if (list.sort === field) update({ order: list.order === 'asc' ? 'desc' : 'asc' })
    else update({ sort: field, order: field === 'name' || field === 'company' ? 'asc' : 'desc' })
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await deleteLead.mutateAsync(deleting.id)
      toast.success(`Deleted “${deleting.name}”`)
    } catch (error) {
      toast.error(errorMessage(error))
      throw error
    }
  }

  const newLeadButton = (
    <ReadOnlyGuard action="create leads" minRole="member">
      <Button onClick={() => setCreating(true)}>
        <Plus aria-hidden="true" />
        New lead
      </Button>
    </ReadOnlyGuard>
  )

  const sortHead = (field: SortableLeadField, label: string, className?: string) => {
    const active = list.sort === field
    const Icon = !active ? ArrowUpDown : list.order === 'asc' ? ArrowUp : ArrowDown
    return (
      <TableHead aria-sort={active ? (list.order === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className="-mx-1 inline-flex items-center gap-1 rounded px-1 font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {label}
          <Icon className={active ? 'size-3.5' : 'size-3.5 opacity-40'} aria-hidden="true" />
        </button>
      </TableHead>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="Every inbound lead with its AI score, priority and sales status." actions={newLeadButton} />

      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative w-full lg:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, company"
            aria-label="Search leads"
            className="pl-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap">
          <SimpleSelect aria-label="Filter by status" value={list.status ?? ALL} onValueChange={(v) => update({ status: v })} options={STATUS_FILTER} className="lg:w-36" />
          <SimpleSelect aria-label="Filter by priority" value={list.priority ?? ALL} onValueChange={(v) => update({ priority: v })} options={PRIORITY_FILTER} className="lg:w-36" />
          <SimpleSelect
            aria-label="Filter by qualification status"
            value={list.qualificationStatus ?? ALL}
            onValueChange={(v) => update({ qualificationStatus: v })}
            options={QUAL_FILTER}
            className="lg:w-40"
          />
          <SimpleSelect aria-label="Filter by source" value={list.source ?? ALL} onValueChange={(v) => update({ source: v })} options={SOURCE_FILTER} className="lg:w-36" />
          <SimpleSelect
            aria-label="Filter by owner"
            value={list.ownerId ?? ALL}
            onValueChange={(v) => update({ ownerId: v })}
            options={ownerFilter.some((o) => o.value === list.ownerId) || !list.ownerId ? ownerFilter : [...ownerFilter, { value: list.ownerId, label: 'Selected owner' }]}
            className="lg:w-40"
          />
          {hasFilters ? (
            <Button variant="ghost" onClick={clearFilters}>
              <X aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      {leads.isError && !page ? (
        <ErrorState error={leads.error} onRetry={() => leads.refetch()} retrying={leads.isFetching} />
      ) : !leads.isPending && rows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={Search}
            title="No leads match these filters"
            description="Try a different search term or remove some filters."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No leads yet"
            description="Leads arrive from your website form or intake API. You can also add one manually, or load sample data from Settings."
            action={
              <>
                {newLeadButton}
                <Button variant="outline" render={<Link to={link('/integrations')} />}>
                  Set up intake
                </Button>
              </>
            }
          />
        )
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border bg-card shadow-xs">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  {sortHead('name', 'Lead', 'min-w-52')}
                  {sortHead('company', 'Company')}
                  <TableHead>Source</TableHead>
                  {sortHead('score', 'Score', 'min-w-32')}
                  <TableHead>Priority</TableHead>
                  <TableHead>Qualification</TableHead>
                  {sortHead('status', 'Status')}
                  <TableHead>Owner</TableHead>
                  {sortHead('created_at', 'Created')}
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={leads.isPlaceholderData ? 'opacity-60' : undefined}>
                {leads.isPending
                  ? Array.from({ length: 8 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="mb-1 h-4 w-32" />
                          <Skeleton className="h-3 w-40" />
                        </TableCell>
                        {Array.from({ length: 8 }, (_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-16" />
                          </TableCell>
                        ))}
                        <TableCell />
                      </TableRow>
                    ))
                  : rows.map((lead) => (
                      <TableRow key={lead.id} className="cursor-pointer" onClick={() => navigate(link(`/leads/${lead.id}`))}>
                        <TableCell className="max-w-64">
                          <div className="flex items-center gap-1.5">
                            <Link
                              to={link(`/leads/${lead.id}`)}
                              onClick={(e) => e.stopPropagation()}
                              className="truncate font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                              {lead.name}
                            </Link>
                            {lead.isSample ? <SampleBadge /> : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{lead.email}</p>
                        </TableCell>
                        <TableCell className="max-w-48 truncate">{lead.company}</TableCell>
                        <TableCell className="text-muted-foreground">{formatEnumLabel(lead.source)}</TableCell>
                        <TableCell>
                          <ScoreBar score={lead.score} thresholds={thresholds} />
                        </TableCell>
                        <TableCell>
                          <PriorityBadge priority={lead.priority} />
                        </TableCell>
                        <TableCell>
                          <QualificationStatusBadge status={lead.qualificationStatus} />
                        </TableCell>
                        <TableCell>
                          <LeadStatusBadge status={lead.status} />
                        </TableCell>
                        <TableCell className="max-w-36 truncate text-muted-foreground">{lead.owner?.fullName ?? (lead.owner ? 'Member' : 'Unassigned')}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums" title={formatDateTime(lead.createdAt)}>
                          {formatShortDate(lead.createdAt)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <RowActions lead={lead} onEdit={() => setEditing(lead)} onDelete={() => setDeleting(lead)} />
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
          {page ? (
            <DataPagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              pageSizeOptions={PAGE_SIZES}
              isFetching={leads.isFetching}
              onPageChange={(p) => update({ page: p })}
              onPageSizeChange={(size) => update({ pageSize: size })}
            />
          ) : null}
        </div>
      )}

      <LeadFormDialog open={creating} onOpenChange={setCreating} />
      <LeadFormDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} lead={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete lead?"
        description={deleting ? `“${deleting.name}” and its activity, qualification history and notes will be permanently removed.` : null}
        confirmLabel="Delete lead"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function RowActions({ lead, onEdit, onDelete }: { lead: Lead; onEdit: () => void; onDelete: () => void }) {
  const navigate = useNavigate()
  const link = useAppLink()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${lead.name}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => navigate(link(`/leads/${lead.id}`))}>Open</DropdownMenuItem>
        <ReadOnlyGuard action="edit leads" minRole="member" className="w-full">
          <DropdownMenuItem onClick={onEdit} className="w-full">
            Edit
          </DropdownMenuItem>
        </ReadOnlyGuard>
        <DropdownMenuSeparator />
        <ReadOnlyGuard action="delete leads" minRole="admin" className="w-full">
          <DropdownMenuItem variant="destructive" onClick={onDelete} className="w-full">
            Delete
          </DropdownMenuItem>
        </ReadOnlyGuard>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
