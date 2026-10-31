// n8n Code node "Prepare Notification". Runs after the qualification row is saved. Decides whether the lead
// is high priority (the Worker's default Slack minPriority) and builds the Slack alert and the optional
// follow-up email.
const startedAt = Date.now()

const ctx = $('Validate & Normalize').first().json
const scored = $('Parse & Score').first().json
const ai = scored.ai
const lead = ctx.lead

// Same layout as buildLeadAlert in apps/api/src/services/slack.ts (no app link: n8n does not know the app URL).
// Slack control characters are escaped so lead input cannot inject mentions (<!channel>) or links.
function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const field = (label, value) => ({ type: 'mrkdwn', text: `*${label}*\n${truncate(esc(value), 1900)}` })
const PRIORITY_EMOJI = { high: ':red_circle:', medium: ':large_orange_circle:', low: ':white_circle:' }

const slackMessage = {
  text: `${cap(ai.priority)} priority lead: ${esc(lead.name)} (${esc(lead.company)}), score ${ai.score}/100`,
  blocks: [
    {
      type: 'header',
      text: { type: 'plain_text', text: truncate(`${PRIORITY_EMOJI[ai.priority]} ${cap(ai.priority)} priority lead: ${esc(lead.name)}`, 150), emoji: true },
    },
    {
      type: 'section',
      fields: [
        field('Lead name', lead.name),
        field('Company', lead.company),
        field('Score', `${ai.score}/100`),
        field('Priority', cap(ai.priority)),
        field('Recommended action', ai.recommendedAction),
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*Inquiry summary*\n${truncate(esc(ai.summary), 2900)}` } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `AI-generated estimate · confidence ${Math.round(ai.confidence * 100)}% · sent by n8n` }],
    },
  ],
}

const firstName = lead.name.split(/\s+/)[0]
const followUp = {
  to: lead.email,
  subject: `Re: your inquiry for ${lead.company}`,
  text: [
    `Hi ${firstName},`,
    '',
    `Thank you for getting in touch about ${lead.company}. We have received your message and a member of our team will reply shortly to discuss next steps.`,
    '',
    'If there is anything you would like to add in the meantime, such as timing, budget or relevant links, simply reply to this email.',
    '',
    'Best regards,',
    'The team',
  ].join('\n'),
}

return [
  {
    json: {
      isHighPriority: ai.priority === 'high',
      slackConfigured: ctx.config.slackConfigured,
      slackSkipReason: ctx.config.slackSkipReason,
      slackMessage,
      followUp,
      marks: { startedAt, preparedAt: Date.now() },
    },
  },
]
