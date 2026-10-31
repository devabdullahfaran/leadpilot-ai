import { useState, type FormEvent } from 'react'
import { Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@leadpilot/shared'
import { useAiSettings, useSaveAiSettings } from '@/api'
import { ConfirmDialog, ErrorState, FormField, ReadOnlyGuard, useMutationGuard } from '@/components/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  CONTEXT_MAX,
  CONTEXT_MIN,
  REQUIRED_CATEGORIES,
  categoryError,
  criteriaTotal,
  validateAiSettings,
  type FieldErrors,
} from './ai-settings-form'
import { Section } from './section'

export function AiTab() {
  const settings = useAiSettings()
  if (settings.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading AI settings">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} retrying={settings.isFetching} />
  }
  return <AiSettingsForm initial={settings.data} key={JSON.stringify(settings.data)} />
}

function NumberInput(props: { value: number; onChange: (n: number) => void; disabled: boolean; min?: number; max?: number; step?: number; className?: string; 'aria-label'?: string }) {
  const { value, onChange, ...rest } = props
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      {...rest}
      className={cn('tabular-nums', props.className)}
    />
  )
}

function AiSettingsForm({ initial }: { initial: AiSettings }) {
  const guard = useMutationGuard({ action: 'edit AI settings', minRole: 'admin' })
  const save = useSaveAiSettings()
  const [draft, setDraft] = useState<AiSettings>(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [newCategory, setNewCategory] = useState('')
  const [categoryInputError, setCategoryInputError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const disabled = !guard.allowed || save.isPending
  const total = criteriaTotal(draft)
  const contextLength = draft.businessContext.trim().length

  function patch(next: Partial<AiSettings>) {
    setDraft((d) => ({ ...d, ...next }))
  }
  function patchCriterion(index: number, next: Partial<AiSettings['criteria'][number]>) {
    setDraft((d) => ({ ...d, criteria: d.criteria.map((c, i) => (i === index ? { ...c, ...next } : c)) }))
  }

  function addCategory() {
    const value = newCategory.trim()
    const err = categoryError(value, draft.categories)
    setCategoryInputError(err)
    if (err) return
    patch({ categories: [...draft.categories, value] })
    setNewCategory('')
  }

  function submit(next: AiSettings, successMessage: string) {
    const result = validateAiSettings(next)
    if (result.errors) {
      setErrors(result.errors)
      toast.error('Fix the highlighted fields before saving')
      return Promise.reject(new Error('invalid'))
    }
    setErrors({})
    return save.mutateAsync(result.data).then(
      () => {
        toast.success(successMessage)
      },
      (err: unknown) => {
        if (err && typeof err === 'object' && 'fieldErrors' in err) setErrors((err as { fieldErrors: FieldErrors }).fieldErrors)
        toast.error(errorMessage(err))
        throw err
      },
    )
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void submit(draft, 'AI settings saved').catch(() => undefined)
  }

  const criteriaError = errors.criteria ?? (total !== 100 ? `Max points total ${total}; it must equal 100.` : null)

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {!guard.allowed ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-[13px] text-muted-foreground">{guard.reason}. These settings are read-only for you.</p>
      ) : null}
      <Section title="Qualification" description="Controls when Gemini scores new leads. Scores are AI-generated estimates; your team can override them.">
        <div className="space-y-3">
          <SwitchRow
            id="ai-enabled"
            label="AI qualification enabled"
            description="When off, leads are stored without an AI score and qualification is skipped."
            checked={draft.enabled}
            onChange={(v) => patch({ enabled: v })}
            disabled={disabled}
          />
          <SwitchRow
            id="ai-auto"
            label="Auto-qualify on intake"
            description="Qualify leads as soon as they arrive through the intake webhook."
            checked={draft.autoQualifyOnIntake}
            onChange={(v) => patch({ autoQualifyOnIntake: v })}
            disabled={disabled}
          />
        </div>
      </Section>

      <Section title="Business context" description="Tells the model what you sell and who a good customer is.">
        <FormField
          label="Business context"
          error={errors.businessContext}
          labelAside={
            <span
              className={cn('text-xs tabular-nums', contextLength < CONTEXT_MIN || contextLength > CONTEXT_MAX ? 'text-danger' : 'text-muted-foreground')}
            >
              {contextLength} / {CONTEXT_MAX}
            </span>
          }
          description={`Between ${CONTEXT_MIN} and ${CONTEXT_MAX} characters.`}
        >
          <Textarea rows={5} value={draft.businessContext} onChange={(e) => patch({ businessContext: e.target.value })} disabled={disabled} />
        </FormField>
      </Section>

      <Section title="Categories" description="Labels the model chooses from. “spam” and “other” are required.">
        <ul className="flex flex-wrap gap-1.5" aria-label="Categories">
          {draft.categories.map((c) => {
            const required = (REQUIRED_CATEGORIES as readonly string[]).includes(c)
            return (
              <li key={c} className="inline-flex h-7 items-center gap-1 rounded-md border bg-background pr-1 pl-2 font-mono text-xs">
                {c}
                {required ? (
                  <span className="px-1 font-sans text-[11px] text-muted-foreground">required</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove category ${c}`}
                    disabled={disabled}
                    onClick={() => patch({ categories: draft.categories.filter((x) => x !== c) })}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        {errors.categories ? <p className="text-xs font-medium text-danger">{errors.categories}</p> : null}
        <div className="flex max-w-md items-start gap-2">
          <FormField label="New category" error={categoryInputError} className="flex-1">
            <Input
              value={newCategory}
              placeholder="e.g. ecommerce"
              disabled={disabled}
              onChange={(e) => {
                setNewCategory(e.target.value)
                setCategoryInputError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCategory()
                }
              }}
            />
          </FormField>
          <Button type="button" variant="outline" className="mt-[22px]" onClick={addCategory} disabled={disabled}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </div>
      </Section>

      <Section title="Scoring criteria" description="The model scores each criterion up to its max points. Max points must total exactly 100.">
        <div className="overflow-x-auto rounded-lg border">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-36">Key</TableHead>
                <TableHead className="min-w-36">Label</TableHead>
                <TableHead className="w-24">Max points</TableHead>
                <TableHead className="min-w-56">Description</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.criteria.map((c, i) => (
                <TableRow key={i} className="align-top">
                  <TableCell>
                    <CellInput error={errors[`criteria.${i}.key`]}>
                      <Input
                        aria-label={`Criterion ${i + 1} key`}
                        className="font-mono text-xs"
                        value={c.key}
                        onChange={(e) => patchCriterion(i, { key: e.target.value })}
                        disabled={disabled}
                      />
                    </CellInput>
                  </TableCell>
                  <TableCell>
                    <CellInput error={errors[`criteria.${i}.label`]}>
                      <Input aria-label={`Criterion ${i + 1} label`} value={c.label} onChange={(e) => patchCriterion(i, { label: e.target.value })} disabled={disabled} />
                    </CellInput>
                  </TableCell>
                  <TableCell>
                    <CellInput error={errors[`criteria.${i}.maxPoints`]}>
                      <NumberInput
                        aria-label={`Criterion ${i + 1} max points`}
                        min={1}
                        max={100}
                        step={1}
                        value={c.maxPoints}
                        onChange={(n) => patchCriterion(i, { maxPoints: n })}
                        disabled={disabled}
                      />
                    </CellInput>
                  </TableCell>
                  <TableCell>
                    <CellInput error={errors[`criteria.${i}.description`]}>
                      <Input
                        aria-label={`Criterion ${i + 1} description`}
                        value={c.description}
                        onChange={(e) => patchCriterion(i, { description: e.target.value })}
                        disabled={disabled}
                      />
                    </CellInput>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove criterion ${c.label || i + 1}`}
                      disabled={disabled || draft.criteria.length <= 1}
                      onClick={() => patch({ criteria: draft.criteria.filter((_, j) => j !== i) })}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || draft.criteria.length >= 10}
            onClick={() => patch({ criteria: [...draft.criteria, { key: '', label: '', maxPoints: Math.max(1, 100 - total), description: '' }] })}
          >
            <Plus aria-hidden="true" />
            Add criterion
          </Button>
          <p className={cn('text-[13px] tabular-nums', total === 100 ? 'text-muted-foreground' : 'font-medium text-danger')} aria-live="polite">
            Total: {total} / 100
          </p>
        </div>
        {criteriaError ? <p className="text-xs font-medium text-danger">{criteriaError}</p> : null}
      </Section>

      <Section title="Priority and review" description="Score thresholds set lead priority; low-confidence results are flagged for human review.">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="High priority from" error={errors['thresholds.high']} description="Score ≥ this value">
            <NumberInput min={2} max={100} step={1} value={draft.thresholds.high} onChange={(n) => patch({ thresholds: { ...draft.thresholds, high: n } })} disabled={disabled} />
          </FormField>
          <FormField label="Medium priority from" error={errors['thresholds.medium']} description="Below this is low">
            <NumberInput min={1} max={99} step={1} value={draft.thresholds.medium} onChange={(n) => patch({ thresholds: { ...draft.thresholds, medium: n } })} disabled={disabled} />
          </FormField>
          <FormField label="Review below confidence" error={errors.reviewConfidence} description="0 = never flag, 1 = always flag">
            <NumberInput min={0} max={1} step={0.05} value={draft.reviewConfidence} onChange={(n) => patch({ reviewConfidence: n })} disabled={disabled} />
          </FormField>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={Number.isFinite(draft.reviewConfidence) ? draft.reviewConfidence : 0}
          onChange={(e) => patch({ reviewConfidence: e.target.valueAsNumber })}
          disabled={disabled}
          aria-label="Review confidence"
          className="w-full max-w-md accent-primary"
        />
        {errors.thresholds ? <p className="text-xs font-medium text-danger">{errors.thresholds}</p> : null}
        {draft.thresholds.high <= draft.thresholds.medium && !errors.thresholds ? (
          <p className="text-xs font-medium text-danger">High threshold must be greater than medium threshold.</p>
        ) : null}
      </Section>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <ReadOnlyGuard action="edit AI settings" minRole="admin">
          <Button type="submit" disabled={save.isPending}>
            <Sparkles aria-hidden="true" />
            {save.isPending ? 'Saving…' : 'Save AI settings'}
          </Button>
        </ReadOnlyGuard>
        <ReadOnlyGuard action="edit AI settings" minRole="admin">
          <Button type="button" variant="ghost" onClick={() => setConfirmReset(true)} disabled={save.isPending}>
            <RotateCcw aria-hidden="true" />
            Reset to defaults
          </Button>
        </ReadOnlyGuard>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset AI settings to defaults?"
        description="Business context, categories, scoring criteria, thresholds and review confidence are replaced with the defaults and saved. Existing lead scores are not changed."
        confirmLabel="Reset and save"
        destructive
        onConfirm={() => submit(DEFAULT_AI_SETTINGS, 'AI settings reset to defaults')}
      />
    </form>
  )
}

function CellInput({ error, children }: { error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {children}
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
    </div>
  )
}

function SwitchRow(props: { id: string; label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={props.id} checked={props.checked} onCheckedChange={(v) => props.onChange(v)} disabled={props.disabled} className="mt-0.5" aria-describedby={`${props.id}-desc`} />
      <div className="space-y-0.5">
        <Label htmlFor={props.id} className="text-[13px]">
          {props.label}
        </Label>
        <p id={`${props.id}-desc`} className="text-xs text-muted-foreground">
          {props.description}
        </p>
      </div>
    </div>
  )
}
