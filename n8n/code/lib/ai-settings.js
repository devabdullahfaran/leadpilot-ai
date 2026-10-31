// Mirrors DEFAULT_AI_SETTINGS, PROMPT_VERSION and SCORE_SUM_TOLERANCE from packages/shared/src.
// This block is inlined into both "Build Gemini Request" and "Parse & Score": if you customize the
// rubric inside n8n, edit it in both nodes (or edit n8n/code/lib/ai-settings.js and rebuild).
const PROMPT_VERSION = 'lp-qualify-v1'
const LEAD_PRIORITIES = ['high', 'medium', 'low']
const SCORE_SUM_TOLERANCE = 5
const AI_SETTINGS = {
  businessContext:
    'We are a small software studio that builds custom web applications, SaaS products, AI automations and integrations for small and mid-sized businesses. Typical projects range from $5,000 to $60,000 and take 4 to 16 weeks.',
  categories: [
    'software_development',
    'web_design',
    'mobile_app',
    'ai_automation',
    'data_analytics',
    'consulting',
    'support_request',
    'partnership',
    'job_application',
    'spam',
    'other',
  ],
  criteria: [
    {
      key: 'intent',
      label: 'Buying intent',
      maxPoints: 25,
      description: 'The inquiry clearly asks for a service or product the business sells, rather than general questions.',
    },
    {
      key: 'fit',
      label: 'Service fit',
      maxPoints: 25,
      description: 'The request matches the services described in the business context.',
    },
    {
      key: 'budget_timeline',
      label: 'Budget & timeline',
      maxPoints: 20,
      description: 'The inquiry mentions a budget, deadline, or concrete project timing.',
    },
    {
      key: 'authority',
      label: 'Company & authority',
      maxPoints: 15,
      description: 'Business email domain, named company, and a job title with decision-making authority.',
    },
    {
      key: 'completeness',
      label: 'Detail & contactability',
      maxPoints: 15,
      description: 'Enough detail to act on and valid contact information.',
    },
  ],
  thresholds: { high: 70, medium: 40 },
  reviewConfidence: 0.6,
}
