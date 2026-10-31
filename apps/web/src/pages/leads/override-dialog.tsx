import { useState, type FormEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  DEFAULT_PRIORITY_THRESHOLDS,
  LEAD_PRIORITIES,
  clampScore,
  priorityFromScore,
  qualificationOverrideSchema,
  type Lead,
  type LeadPriority,
  type PriorityThresholds,
} from '@leadpilot/shared'
import { useOverrideQualification } from '@/api'
import { FormField } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api-client'
import { enumOptions } from './lib'
import { SimpleSelect } from './simple-select'

const PRIORITY_OPTIONS = enumOptions(LEAD_PRIORITIES)
const NO_CATEGORY = '__keep'

interface OverrideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lead: Lead
  thresholds?: PriorityThresholds
  categories?: string[]
}

export function OverrideDialog({ open, onOpenChange, ...rest }: OverrideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <OverrideForm {...rest} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

type Field = 'score' | 'priority' | 'category' | 'reason'

function OverrideForm({ lead, thresholds = DEFAULT_PRIORITY_THRESHOLDS, categories, onDone }: Omit<OverrideDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const override = useOverrideQualification()
  const [score, setScore] = useState(lead.score ?? 50)
  const [priority, setPriority] = useState<LeadPriority>(lead.priority ?? priorityFromScore(lead.score ?? 50, thresholds))
  const [priorityTouched, setPriorityTouched] = useState(false)
  const [category, setCategory] = useState(NO_CATEGORY)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})

  function changeScore(value: number) {
    const next = Number.isFinite(value) ? clampScore(Math.round(value)) : 0
    setScore(next)
    if (!priorityTouched) setPriority(priorityFromScore(next, thresholds))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = qualificationOverrideSchema.safeParse({
      score,
      priority,
      category: category === NO_CATEGORY ? undefined : category,
      reason,
    })
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {}
      for (const issue of parsed.error.issues) next[issue.path[0] as Field] ??= issue.message
      setErrors(next)
      return
    }
    setErrors({})
    try {
      await override.mutateAsync({ leadId: lead.id, data: parsed.data })
      toast.success(`Qualification overridden: ${parsed.data.score} · ${parsed.data.priority} priority`)
      onDone()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const categoryOptions = [
    { value: NO_CATEGORY, label: lead.category ? `Keep current (${lead.category})` : 'No category' },
    ...(categories ?? []).map((c) => ({ value: c, label: c })),
  ]

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Override qualification</DialogTitle>
        <DialogDescription>Set the score and priority manually. The AI result stays in the history; this is recorded as a manual override.</DialogDescription>
      </DialogHeader>
      <FormField label="Score (0–100)" error={errors.score}>
        <Input type="number" min={0} max={100} step={1} value={score} onChange={(e) => changeScore(e.target.valueAsNumber)} className="w-24 tabular-nums" />
      </FormField>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={score}
        onChange={(e) => changeScore(e.target.valueAsNumber)}
        aria-label="Score slider"
        className="-mt-2 w-full accent-primary"
      />
      <FormField label="Priority" error={errors.priority} description={priorityTouched ? undefined : 'Follows the score using the workspace thresholds.'}>
        <SimpleSelect
          value={priority}
          onValueChange={(v) => {
            setPriority(v as LeadPriority)
            setPriorityTouched(true)
          }}
          options={PRIORITY_OPTIONS}
        />
      </FormField>
      <FormField label="Category (optional)" error={errors.category}>
        <SimpleSelect value={category} onValueChange={setCategory} options={categoryOptions} />
      </FormField>
      <FormField label="Reason *" error={errors.reason}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spoke with them on the phone; budget confirmed." />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={override.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={override.isPending}>
          {override.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          Save override
        </Button>
      </DialogFooter>
    </form>
  )
}
