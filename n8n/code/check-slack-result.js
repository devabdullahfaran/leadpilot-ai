// n8n Code node "Check Slack Result". Runs after "Slack Alert", or directly from "Slack Configured?" when
// SLACK_WEBHOOK_URL is not set. A Slack failure never fails the lead pipeline (execution becomes 'partial').
// @include lib/http.js
const checkedAt = Date.now()

const prepared = $('Prepare Notification').first().json
let slack
if (!$('Slack Alert').isExecuted) {
  slack = { status: 'skipped', message: prepared.slackSkipReason || 'Slack alert not sent' }
} else {
  // Messages follow postToSlack in apps/api/src/services/slack.ts.
  const res = httpResult($('Slack Alert').first().json)
  if (res.ok) slack = { status: 'succeeded', message: 'Slack alert sent' }
  else if (res.status !== null) slack = { status: 'failed', message: `Slack returned ${res.error}` }
  else if (/timed?\s*out|ETIMEDOUT|ECONNABORTED/i.test(res.error)) slack = { status: 'failed', message: 'Slack did not respond within 10s' }
  else slack = { status: 'failed', message: 'Could not reach Slack (network error)' }
}

return [{ json: { slack, marks: { checkedAt } } }]
