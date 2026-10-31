// n8n Code node "Finalize Response". Adds the recorded execution id to the webhook response. If recording
// the execution failed, the response still reports the lead outcome (without executionId) and the failure
// stays visible in the n8n execution log.
// @include lib/http.js
const record = $('Build Execution Record').first().json
const res = httpResult($input.first().json)
const executionId = res.ok && Array.isArray(res.body) && res.body[0] && res.body[0].id ? res.body[0].id : null

const result = { leadId: record.responseBody.leadId }
if (executionId) result.executionId = executionId
result.duplicate = record.responseBody.duplicate
result.qualificationStatus = record.responseBody.qualificationStatus
result.engine = 'n8n'

const body = record.httpStatus < 400 ? result : { error: { ...record.responseError, details: result } }

return [
  {
    json: {
      httpStatus: record.httpStatus,
      body,
      executionRecorded: executionId !== null,
      executionRecordError: executionId ? null : res.error || 'Execution insert returned no row',
    },
  },
]
