# n8n workflow (optional, self-hosted)

`n8n/leadpilot-lead-qualification.workflow.json` is an importable n8n v2.x (Community Edition) workflow that runs the same lead pipeline as the LeadPilot Worker: validate → deduplicate → Gemini classification → score reconciliation → persist → activity log → Slack alert → (optional) follow-up email → execution record.

**It runs only while your own n8n instance is running.** The public LeadPilot app does not depend on it; the Worker implements the full pipeline itself. The workflow file was built and statically validated in this repo (see [Verification](#verification)), and it was executed in a live local n8n 2.45.7 with AI disabled (see [Local run](#local-run-2026-10-31)). The Gemini and Slack branches have not yet run inside n8n.

## What it does

| Step | Node(s) | Behaviour |
| --- | --- | --- |
| Intake | `Lead Intake Webhook` (POST `leadpilot-intake`) | Responds via the `Respond …` nodes. |
| validate | `Validate & Normalize`, `Valid Lead?`, `Respond Rejected` | Same field limits as `intakeSchema`; email lowercased/trimmed, phone and website normalized like `packages/shared/src/normalize.ts`. Honeypot (`hp` filled) → `202 {accepted:true}`, nothing stored. Invalid → `422` with field errors. Missing/invalid config → `500`. |
| deduplicate | `Find Existing Lead`, `Lookup OK?` | `GET /rest/v1/leads?workspace_id=eq…&email_normalized=eq…`. |
| ai_classify | `Build Gemini Request`, `Gemini Classify`, `Parse & Score` | Same system instruction, prompt (email domain only, no name) and `responseJsonSchema` as `packages/shared/src/ai.ts` with default AI settings. Output validated like `aiQualificationOutputSchema`; score reconciled like `reconcileScore`; priority by thresholds 70/40; outcome with 0.6 confidence. 3 attempts, 2 s apart, 20 s timeout. |
| persist | `Duplicate?`, `Update Lead` / `Create Lead` (source `n8n`), `Prepare Lead Records`, `Lead Saved?`, `Log Activity`, `AI Succeeded?`, `Save Qualification` | Qualification row uses source `ai`, the model id and prompt version `lp-qualify-v1`. |
| notify_slack | `Prepare Notification`, `High Priority?`, `Slack Configured?`, `Slack Alert`, `Check Slack Result` | Only high-priority leads; Block Kit message with the same fields as the Worker's alert. A Slack failure marks the run `partial`, never fails it. Skipped when `SLACK_WEBHOOK_URL` is empty. |
| email_followup | `Send Follow-up Email` | **Disabled by default.** Plain follow-up email; needs SMTP credentials. |
| record | `Build Execution Record`, `Record Execution`, `Finalize Response`, `Respond to Webhook` | Inserts a `workflow_executions` row (`workflow_key lead_intake`, `engine n8n`, `trigger n8n_webhook`, `steps[]` in the `ExecutionStep` shape) and responds `200 {leadId, executionId?, duplicate, qualificationStatus, engine:'n8n'}`. |

**When Gemini fails after retries**, the lead is still saved with `qualification_status = 'failed'` and `qualification_error`, a `partial` execution is recorded (as the Worker does; `failed` is used when the lead itself could not be saved), and the webhook responds `502` (or `429` for provider quota) with an `error` object explaining that AI did not run.

## Prerequisites

- n8n 2.x, which needs **Node.js 24+**: `npx n8n` or Docker (`docker run -it --rm -p 5678:5678 -v n8n_data:/home/node/.n8n n8nio/n8n`). This repo pins Node 22 for the app; use a separate Node 24 install (or Docker) for n8n.
- A LeadPilot Supabase project with migrations applied, and the workspace UUID leads should land in.
- A Gemini API key. Optionally a Slack incoming webhook and an SMTP account.

## Environment variables (set on the n8n process)

| Variable | Required | Purpose |
| --- | --- | --- |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | yes | Lets nodes read `$env` (n8n v2 blocks it by default). `$vars` is not available in Community Edition. |
| `LEADPILOT_WORKSPACE_ID` | yes | Workspace UUID for new leads. |
| `SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` (no trailing path). |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.5-flash-lite`. |
| `SLACK_WEBHOOK_URL` | no | Slack incoming webhook; empty → Slack step `skipped`. |
| `FOLLOWUP_FROM_EMAIL` | only if email enabled | Sender address for the follow-up email. |

Docker example: `docker run -it --rm -p 5678:5678 -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false -e LEADPILOT_WORKSPACE_ID=… -e SUPABASE_URL=… -v n8n_data:/home/node/.n8n n8nio/n8n`.

Note that with env access enabled, anyone who can edit workflows on that instance can read these variables, so keep secrets in credentials, not env vars (the Slack webhook URL is the one secret-ish value in env; treat it accordingly).

## Credentials

The export references credentials by placeholder id (`REPLACE_ON_IMPORT_*`) and name only. After import, create these in **Credentials → New** and select them on each node that shows a warning:

1. **LeadPilot Supabase secret key (apikey header)** — type *Header Auth*, Name `apikey`, Value your `sb_secret_…` key. New secret keys go only in the `apikey` header. If you still use a legacy `service_role` JWT, it must be sent as both `apikey` and `Authorization: Bearer …`: create a *Custom Auth* (`httpCustomAuth`) credential with `{"headers":{"apikey":"<jwt>","Authorization":"Bearer <jwt>"}}` and switch the Supabase nodes to it.
2. **LeadPilot Gemini API key (x-goog-api-key header)** — type *Header Auth*, Name `x-goog-api-key`, Value your Gemini key.
3. **LeadPilot SMTP (optional follow-up email)** — type *SMTP*; only needed if you enable `Send Follow-up Email`.

Optional webhook protection: set the webhook node's Authentication to *Header Auth* with a credential such as Name `X-LeadPilot-Token`, then send that header (`N8N_WEBHOOK_HEADER="X-LeadPilot-Token: …" ./n8n/send-test-lead.sh`). Recommended for any instance reachable from the internet.

## Import

- UI: **Workflows → Import from File** → choose `n8n/leadpilot-lead-qualification.workflow.json`.
- CLI: `n8n import:workflow --input=n8n/leadpilot-lead-qualification.workflow.json`.

The workflow imports inactive. Optionally set **Settings → Error workflow** to a workflow of yours that alerts on unexpected crashes (not set in the export).

## Testing

1. Open the workflow, click **Execute workflow** (it waits for one test call).
2. Run `./n8n/send-test-lead.sh` — posts `n8n/sample-lead.json` to `http://localhost:5678/webhook-test/leadpilot-intake`. Pass a different URL or payload as arguments.
3. After **activating** the workflow, use the production URL: `./n8n/send-test-lead.sh http://localhost:5678/webhook/leadpilot-intake`.

The sample lead is a real write: it creates (or updates) a lead in the configured workspace. It uses `example.com` data and its message is prefixed `[Sample test lead]`, but it is not flagged `is_sample`; delete it from LeadPilot when done.

## In LeadPilot

Each run inserts a `workflow_executions` row with `engine = 'n8n'`; it appears on the **Workflows** page alongside Worker runs, with the per-step timeline (validate, deduplicate, ai_classify, persist, notify_slack, email_followup). Honeypot and invalid submissions are rejected before anything is stored and do not create executions.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `500` with config errors / `$env` access denied | Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and the required env vars, then restart n8n. |
| `404` on webhook-test URL | Click **Execute workflow** first; test URLs accept a single call. Use `/webhook/` after activation. |
| Supabase `401`/`403` | Wrong credential or legacy JWT in a Header Auth credential (see Credentials). |
| Gemini `400`/`404` | Check `GEMINI_MODEL` and the key. `429` → quota; the lead is saved as `failed`. |
| No Slack message | Only `high` priority leads alert; check `SLACK_WEBHOOK_URL` and the `notify_slack` step message. |

## Security notes

- Keep the Supabase secret key and Gemini key in n8n credentials only; never in env vars, node parameters or the exported JSON. `node n8n/validate-workflow.mjs` rejects exports containing key-like strings or inline auth headers.
- The Supabase secret key **bypasses RLS**. Anyone who can edit workflows or credentials on your n8n can read/write every workspace. Restrict access to the n8n instance (owner account, no public editor, HTTPS, webhook header auth).
- The prompt sends Gemini the lead's email domain, not the full email or name.

## Maintaining the workflow

The Code node sources live in `n8n/code/*.js` (shared helpers in `n8n/code/lib/`). Edit those, then rebuild and check:

## Verification

```sh
node n8n/build-workflow.mjs                                            # regenerates the JSON from template + code files
node n8n/validate-workflow.mjs n8n/leadpilot-lead-qualification.workflow.json
node --test n8n/test/                                                  # runs Code nodes against fixtures, checks parity with packages/shared
```

## Local run (2026-10-31)

Executed in the official `n8nio/n8n:2.45.7` Docker image against local PostgreSQL + PostgREST (a small test proxy served `/rest/v1` and mapped the `apikey` header to a Bearer token, as the Supabase gateway does). The workflow and credentials were imported with `n8n import:workflow` / `n8n import:credentials`, then activated, and called on the production webhook URL. `AI_ENABLED=false`, no Slack URL.

| Request | Response | Database result |
|---|---|---|
| New lead | 200 `duplicate:false`, `qualificationStatus:"skipped"` | lead created (`source n8n`, `submission_count 1`), `lead_created` activity, execution `engine n8n` succeeded |
| Same email again | 200 `duplicate:true` | `submission_count 2`, `duplicate_submission` activity, second execution |
| Honeypot filled | 202 `{"accepted":true}` | nothing stored |
| Invalid email / short message | 422 with field errors | nothing stored |
| Missing `X-LeadPilot-Token` | 403 | nothing stored |

Execution steps recorded: validate ✓, deduplicate ✓, ai_classify skipped, persist ✓, notify_slack skipped, email_followup skipped. **Not yet exercised inside n8n:** the Gemini call, the quota reservation with AI enabled, Slack delivery, and the email node.
