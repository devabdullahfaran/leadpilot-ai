# LeadPilot AI — REST API

Base URL: `https://<worker-name>.<account-subdomain>.workers.dev/api/v1` (local: `http://localhost:8787/api/v1`).
Types referenced below live in `packages/shared/src/types.ts` and `schemas.ts`.

## Conventions

* JSON in/out, camelCase. Bodies ≤ 64 KB.
* **Auth:** `Authorization: Bearer <Supabase access token>`. Optional `X-Workspace-Id: <uuid>` selects the workspace (default: the caller's oldest membership; non-member → `403 forbidden`).
* **Roles:** `viewer` (read) < `member` (create/edit leads, notes, run AI, override) < `admin` (delete leads, settings, integrations, sample data) < `owner`.
* **Errors:** `{ "error": { "code": ApiErrorCode, "message": string, "details"?: any, "requestId": string } }`.
  `400 bad_request` · `401 unauthorized` · `403 forbidden | read_only` · `404 not_found` · `409 conflict | duplicate_lead` · `413 payload_too_large` · `422 validation_error` (details = `[{path, message}]`) · `429 rate_limited | ai_quota_exceeded` (`Retry-After` header) · `502 ai_unavailable | ai_invalid_response | integration_failed` · `503 ai_disabled | ai_not_configured | integration_not_configured` · `500 internal_error`.
* Every response carries `X-Request-Id`.
* **Portfolio preview:** every resource route below (not `/me`, not `/intake`) is also mounted read-only at `/api/v1/demo/...` without auth, scoped to the seeded sample workspace. Mutations there return `403 read_only`.

## Health & session

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health` | — | `{ status, version, environment, time }` |
| GET | `/me` | user | `SessionInfo` (user, workspaces with roles, activeWorkspaceId) |
| PATCH | `/me/profile` | user | body `profileUpdateSchema` → `{ fullName }` |

## Dashboard & analytics

| Method | Path | Role | Response |
|---|---|---|---|
| GET | `/dashboard/summary` | viewer | `DashboardSummary` (totals, conversion funnel, win rate, AI activity incl. today's quota use, workflow status (7 days), 5 recent leads, 5 recent failed/partial executions, sample record count) |
| GET | `/analytics?days=30` | viewer | `AnalyticsResponse` (days 7–365) |

## Leads

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/leads` | viewer | Query `leadListQuerySchema` (`q` searches name/email/company, filters, `sort`, `order`, `page`, `pageSize` ≤ 100) → `Paginated<Lead>` |
| POST | `/leads` | member | body `leadCreateSchema` → `201 { lead: Lead }`. Same normalized email in workspace → `409 duplicate_lead` with `details.existingLeadId`. Logs `lead_created`. |
| GET | `/leads/duplicates` | viewer | Query `duplicateCheckQuerySchema` → `{ matches: { id, name, email, company, matchedOn: ('email'\|'phone'\|'company')[] }[] }` (≤ 5) |
| GET | `/leads/:id` | viewer | `Lead` |
| PATCH | `/leads/:id` | member | body `leadUpdateSchema` → `Lead`. Logs `lead_updated`, `status_changed`, `owner_changed` as applicable. Owner must be a workspace member (422). Email collision → `409 duplicate_lead`. |
| DELETE | `/leads/:id` | admin | `204` |
| GET | `/leads/:id/activities` | viewer | `{ data: LeadActivity[] }` newest first (≤ 100) |
| POST | `/leads/:id/notes` | member | body `noteCreateSchema` → `201 LeadActivity` |
| GET | `/leads/:id/qualifications` | viewer | `{ data: LeadQualification[] }` newest first |
| POST | `/leads/:id/qualify` | member | Runs the AI pipeline now → `QualifyResult`. Extra rate limit (6/min/user). Errors: `ai_disabled`, `ai_not_configured`, `ai_quota_exceeded`, `ai_unavailable`, `ai_invalid_response` (the failed execution is still recorded). |
| POST | `/leads/:id/override` | member | body `qualificationOverrideSchema` → `{ lead, qualification }` (manual history row + `qualification_override` activity) |

## Workflows

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workflows/overview` | viewer | `{ data: WorkflowOverviewItem[] }` per workflow key × engine |
| GET | `/workflows/executions` | viewer | Query `executionListQuerySchema` → `Paginated<WorkflowExecution>` newest first |
| GET | `/workflows/executions/:id` | viewer | `WorkflowExecution & { notifications: NotificationEvent[] }` |
| POST | `/workflows/executions/:id/retry` | member | Only for `failed`/`partial` Worker executions that have a lead. Re-runs qualification with `trigger='retry'`, `attempt+1`, `retryOfId` → `QualifyResult`. n8n executions → `409 conflict` (retry them in n8n). |

## Integrations

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/integrations` | viewer | `IntegrationsStatus` — configuration flags, masked hints, usage counters. Never secrets. |
| GET | `/integrations/ai-usage` | viewer | `{ data: AiUsageEvent[] }` last 50 |
| PUT | `/integrations/slack` | admin | body `slackSettingsSchema`. `webhookUrl` required on first setup; stored AES-GCM encrypted server-side → `IntegrationsStatus['slack']`. `503 integration_not_configured` if `ENCRYPTION_KEY` is missing. |
| DELETE | `/integrations/slack` | admin | `204` (removes secret + settings) |
| POST | `/integrations/slack/test` | admin | Sends a real test message → `{ status: 'sent' }` or `502 integration_failed`. Recorded as a `slack_notification` execution (`trigger='test'`). |
| POST | `/integrations/intake-key` | admin | Creates/rotates the intake key → `201 { key, prefix, endpoint }`. The key is shown once and stored as a SHA-256 hash. |

## Settings

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/settings/ai` | viewer | `AiSettings` (defaults when never saved) |
| PUT | `/settings/ai` | admin | body `aiSettingsSchema` → `AiSettings` |
| PATCH | `/settings/workspace` | admin | body `workspaceUpdateSchema` → `WorkspaceSummary` |
| GET | `/settings/members` | viewer | `{ data: MemberSummary[] }` |
| POST | `/settings/sample-data` | admin | Loads the synthetic dataset (`is_sample=true`) → `201 { leads }` |
| DELETE | `/settings/sample-data` | admin | Removes all sample rows → `{ leads }` |

## Webhook intake (public)

`POST /intake/:workspaceId`

* Headers: `X-Intake-Key: lpk_…` (required), `Idempotency-Key: <8–200 chars>` (optional; falls back to body `submissionId`).
* Body: `intakeSchema` (`hp` is a honeypot and must be empty).
* Responses: `201 IntakeResult` (new lead) · `200 IntakeResult` (existing lead updated, or idempotent replay with `replayed: true`) · `202 { accepted: true }` (honeypot — nothing stored) · `401 unauthorized` (bad key) · `422` · `429`.
* Pipeline: validate → deduplicate → persist → AI qualify (if enabled for the workspace and within quota; otherwise the lead is stored with `qualificationStatus` `skipped`/`failed` and the reason is recorded) → Slack. One `lead_intake` execution row per request.
* CORS: any origin (the key is the credential; rate limited per IP).
