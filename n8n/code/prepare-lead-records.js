// n8n Code node "Prepare Lead Records". Runs after "Update Lead" or "Create Lead": resolves the saved lead
// and builds the lead_activities rows and the lead_qualifications row (source 'ai').
// @include lib/http.js
const leadSavedAt = Date.now()

const ctx = $('Validate & Normalize').first().json
const scored = $('Parse & Score').first().json
const write = httpResult($input.first().json)
const workspaceId = ctx.config.workspaceId
const n8nExecutionId = $execution.id

let leadError = null
let row = null
if (!write.ok) {
  leadError = `Lead ${scored.duplicate ? 'update' : 'insert'} failed (${write.error})`
  if (write.status === 409) leadError += '. Another submission with this email was saved at the same time; resubmit to update it.'
} else if (!Array.isArray(write.body) || !write.body[0] || !write.body[0].id) {
  leadError = scored.duplicate
    ? 'The existing lead was not found when updating it (it may have just been deleted).'
    : 'Lead insert returned no row.'
} else {
  row = write.body[0]
}

const leadSaved = row !== null
const leadId = leadSaved ? row.id : null
const ai = scored.ai
const qualificationStatus = ai ? ai.qualificationStatus : scored.aiSkipped ? 'skipped' : 'failed'

const activities = []
const qualification =
  leadSaved && ai
    ? {
        workspace_id: workspaceId,
        lead_id: leadId,
        source: 'ai',
        score: ai.score,
        priority: ai.priority,
        category: ai.category,
        summary: ai.summary,
        reasoning: ai.reasoning,
        recommended_action: ai.recommendedAction,
        confidence: ai.confidence,
        criteria: ai.criteria,
        adjustments: ai.adjustments,
        model: ai.model,
        prompt_version: ai.promptVersion,
      }
    : null

// Activity bodies and metadata follow apps/api/src/services/{intake,qualification}.ts. The n8n execution id
// stands in for the LeadPilot execution id, which is only known once "Record Execution" has run.
if (leadSaved) {
  const base = { workspace_id: workspaceId, lead_id: leadId, actor_id: null }
  const origin = { trigger: 'n8n_webhook', engine: 'n8n', n8nExecutionId }
  activities.push(
    scored.duplicate
      ? {
          ...base,
          type: 'duplicate_submission',
          body: 'Repeat submission received; the inquiry message was updated to the latest one.',
          metadata: { submissionCount: row.submission_count, source: ctx.lead.submittedSource, ...origin },
        }
      : { ...base, type: 'lead_created', body: 'Received via n8n webhook', metadata: { source: ctx.lead.submittedSource, ...origin } },
  )
  // Like the Worker, AI being switched off is not a failure and logs no qualification activity.
  if (!scored.aiSkipped) activities.push(
    ai
      ? {
          ...base,
          type: 'qualification_completed',
          body: ai.summary,
          metadata: {
            score: ai.score,
            priority: ai.priority,
            category: ai.category,
            status: ai.qualificationStatus,
            model: ai.model,
            ...origin,
          },
        }
      : {
          ...base,
          type: 'qualification_failed',
          body: scored.aiError.apiMessage,
          metadata: { code: scored.aiError.code, model: ctx.config.geminiModel, ...origin },
        },
  )
}

return [
  {
    json: {
      leadSaved,
      leadId,
      leadError,
      duplicate: scored.duplicate,
      submissionCount: leadSaved ? row.submission_count : null,
      aiOk: scored.aiOk,
      qualificationStatus,
      activities,
      qualification,
      marks: { leadSavedAt },
    },
  },
]
