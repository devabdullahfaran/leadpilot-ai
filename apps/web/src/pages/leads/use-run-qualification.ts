import { toast } from 'sonner'
import { useQualifyLead } from '@/api'
import { formatEnumLabel } from '@/lib/format'
import { aiErrorMessage } from './lib'

/** Runs the AI pipeline for a lead and reports the real outcome in a toast. Never throws. */
export function useRunQualification() {
  const qualify = useQualifyLead()

  async function run(leadId: string, leadName?: string) {
    const toastId = toast.loading(`Running AI qualification${leadName ? ` for ${leadName}` : ''}…`)
    try {
      const result = await qualify.mutateAsync(leadId)
      const { lead, qualification } = result
      if (qualification) {
        const review = lead.qualificationStatus === 'needs_review' ? ' · flagged for review' : ''
        toast.success(`AI score ${qualification.score} · ${formatEnumLabel(qualification.priority)} priority${review}`, {
          id: toastId,
          description: 'AI-generated estimate. Review before acting on it.',
        })
      } else {
        toast.info(`Qualification ${formatEnumLabel(lead.qualificationStatus).toLowerCase()}`, {
          id: toastId,
          description: lead.qualificationError ?? 'No AI result was produced for this lead.',
        })
      }
      return result
    } catch (error) {
      toast.error('AI qualification failed', { id: toastId, description: aiErrorMessage(error) })
      return null
    }
  }

  return { run, isPending: qualify.isPending }
}
