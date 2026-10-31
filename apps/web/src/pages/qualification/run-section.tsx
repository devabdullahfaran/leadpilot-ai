import { useEffect, useId, useState } from 'react'
import type { AiSettings, Lead } from '@leadpilot/shared'
import { toast } from 'sonner'
import { z } from 'zod'
import { ChevronsUpDown, Play } from 'lucide-react'
import { useLeads, useQualifyLead } from '@/api'
import { QualificationStatusBadge, ReadOnlyGuard, SampleBadge } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { aiErrorToast } from './ai-errors'
import { QualifyErrorPanel, QualifyResultPanel } from './result-panel'

const runSchema = z.object({ leadId: z.string().min(1, 'Choose a lead to qualify') })

export function RunSection({ settings }: { settings?: AiSettings }) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const qualify = useQualifyLead()
  const errorId = useId()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = runSchema.safeParse({ leadId: lead?.id ?? '' })
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Choose a lead')
      return
    }
    setFieldError(null)
    qualify.mutate(parsed.data.leadId, {
      onSuccess: () => toast.success(`Qualification finished for ${lead?.name ?? 'lead'}`),
      onError: (error) => {
        const t = aiErrorToast(error)
        toast.error(t.title, { description: t.description })
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run a qualification</CardTitle>
        <CardDescription>Score one lead now. Each run makes a real model call, counts toward today’s quota and is recorded as an execution.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
          <div className="min-w-0 flex-1 space-y-1">
            <span className="sr-only" id={`${errorId}-label`}>
              Lead
            </span>
            <LeadPicker
              value={lead}
              onChange={(l) => {
                setLead(l)
                setFieldError(null)
                qualify.reset()
              }}
              invalid={Boolean(fieldError)}
              describedBy={fieldError ? errorId : undefined}
              labelledBy={`${errorId}-label`}
            />
            {fieldError ? (
              <p id={errorId} className="text-xs text-destructive">
                {fieldError}
              </p>
            ) : null}
          </div>
          <ReadOnlyGuard action="run AI qualification" minRole="member">
            <Button type="submit" disabled={qualify.isPending}>
              <Play aria-hidden="true" />
              {qualify.isPending ? 'Running…' : 'Run AI'}
            </Button>
          </ReadOnlyGuard>
        </form>

        {qualify.isPending ? (
          <div className="space-y-3 rounded-lg border p-4" aria-busy="true" aria-label="Waiting for the AI result">
            <div className="grid gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : qualify.isError ? (
          <QualifyErrorPanel error={qualify.error} />
        ) : qualify.data ? (
          <QualifyResultPanel result={qualify.data} settings={settings} />
        ) : null}
      </CardContent>
    </Card>
  )
}

interface LeadPickerProps {
  value: Lead | null
  onChange: (lead: Lead) => void
  invalid: boolean
  describedBy?: string
  labelledBy: string
}

function LeadPicker({ value, onChange, invalid, describedBy, labelledBy }: LeadPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(id)
  }, [search])
  const leads = useLeads({ q: debounced || undefined, pageSize: 20, sort: 'created_at', order: 'desc' })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-labelledby={labelledBy}
            className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
          />
        }
      >
        <span className="truncate">{value ? `${value.name} · ${value.company}` : 'Select a lead…'}</span>
        <ChevronsUpDown className="opacity-50" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search name, email or company…" value={search} onValueChange={setSearch} aria-label="Search leads" />
          <CommandList>
            {leads.isPending ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
              </div>
            ) : leads.isError ? (
              <p className="p-3 text-xs text-destructive">Couldn’t load leads. Try again.</p>
            ) : (
              <>
                <CommandEmpty>No leads match “{debounced}”.</CommandEmpty>
                <CommandGroup>
                  {leads.data.data.map((lead) => (
                    <CommandItem
                      key={lead.id}
                      value={lead.id}
                      data-checked={value?.id === lead.id}
                      onSelect={() => {
                        onChange(lead)
                        setOpen(false)
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{lead.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{lead.company}</span>
                      </span>
                      {lead.isSample ? <SampleBadge /> : null}
                      <QualificationStatusBadge status={lead.qualificationStatus} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
