# Demo recording checklist

## Setup

- [ ] Use the deployed app if it exists; otherwise `npm run dev:local` and record the preview at `http://127.0.0.1:5173/preview/dashboard`.
- [ ] For signed-in beats (create lead, run AI, Slack): a throwaway account on your own Supabase project, a Gemini key with quota left, a test Slack channel.
- [ ] Only synthetic data on screen. Close tabs showing keys, `.dev.vars`, dashboards with secrets.
- [ ] Browser at 1440×900, zoom 100%, notifications off.

## Script (2–3 minutes)

| Time | Beat | Show |
|---|---|---|
| 0:00 | Problem | "Inbound leads pile up; LeadPilot scores them and alerts on the good ones." |
| 0:15 | Dashboard | Funnel, AI activity and today's quota, workflow status, sample badges. |
| 0:35 | Leads | Search/filter, priority and score badges, duplicate warning when creating a lead. |
| 0:55 | AI qualification | Lead detail: run Qualify (signed in) or show an existing result: criteria breakdown, reasoning, adjustments, `needs_review`, AI disclaimer, override. |
| 1:30 | Workflows | Execution timeline with per-step timing; a failed/partial run and Retry. |
| 1:50 | Integrations | Slack (masked hint, test message), intake key shown once, AI usage list. |
| 2:10 | Security & cost | Mention RLS, column grants, server-only keys, quota reservation, kill switch. Optionally `/preview` vs signed-in read-only guard. |
| 2:30 | Code / n8n | Repo structure, test commands, the n8n workflow JSON as an optional alternative. |

## Do NOT claim

- Real customers, users, conversion lift or any usage metric: all data is synthetic.
- That n8n has been run, unless you have actually executed it in n8n.
- AI accuracy numbers. Mention only what the run on screen shows.
- That the app is deployed, unless the URL works at recording time.
- Production-grade compliance (GDPR etc.); Gemini free tier may use prompts for product improvement.
