# LeadPilot AI — Architecture & Implementation Plan

Status tracker for the build. Updated as work lands; "Done" means implemented **and** verified by a command that was actually run.

## 1. Architecture

```
Browser (React SPA, Cloudflare Pages)
  │  supabase-js: Auth only (sign up / sign in / reset)          ┌──────────────────────────┐
  │  fetch + Bearer <Supabase access token>  ──────────────────▶ │ Hono API (CF Worker)     │
  │  fetch /api/v1/demo/* (no auth, read-only preview)           │  • JWT verify (JWKS)      │
  ▼                                                              │  • RLS-scoped PostgREST   │
Website forms / n8n ── POST /api/v1/intake/:workspaceId ───────▶ │  • service-role writes    │
                         (X-Intake-Key, Idempotency-Key)         │  • Gemini (structured)    │
                                                                 │  • Slack webhook          │
                                                                 └────────────┬─────────────┘
                                                                              │ PostgREST
                                                                 ┌────────────▼─────────────┐
n8n (self-hosted, optional) ── Gemini HTTP ── Supabase REST ───▶ │ Supabase Postgres + Auth │
   same contracts, writes engine='n8n' execution rows            │  RLS on every table       │
                                                                 └──────────────────────────┘
```

* **The public app never depends on n8n.** The Worker runs the complete intake → dedupe → AI → persist → Slack pipeline itself. n8n is an independently runnable automation that implements the same steps with the same data contracts and writes `workflow_executions` rows with `engine = 'n8n'`.
* **Browser never sees privileged keys.** It only has the Supabase *publishable* key (for Auth) and the API URL.
* **Data access:** user requests use a PostgREST client carrying the user's JWT → RLS enforced. System writes (AI results, executions, usage, notifications, secrets) use the service role *after* an explicit role check in the Worker. Column-level grants stop users from writing AI fields directly.
* **Preview mode:** `/api/v1/demo/*` mounts the same read handlers with a read-only scope pinned to the single `is_demo` workspace (synthetic `is_sample` rows only).

## 2. Key decisions (verified 2026-10-31)

| Topic | Decision |
|---|---|
| Gemini model | `gemini-3.5-flash-lite` (stable, free tier). Fallback `gemini-3.6-flash`. 2.5-series is closed to new projects. Configurable via `GEMINI_MODEL`. |
| Gemini request | `POST v1beta/models/{model}:generateContent`, header `x-goog-api-key`, `generationConfig.responseMimeType=application/json` + `responseJsonSchema`, `thinkingConfig.thinkingLevel=MINIMAL`, no temperature (ignored on new models). Server-side Zod validation; schema `minLength/maxLength` are ignored by Gemini. |
| Gemini privacy | Free tier data may be used by Google to improve products → prompt sends email **domain** only, no name/phone; docs warn not to submit real PII. Free tier may not be offered to end users in EEA/CH/UK. |
| Supabase keys | `sb_publishable_…` (browser + user-scoped API calls in `apikey`), `sb_secret_…` (Worker only, `apikey` header only, never Bearer). Legacy JWT keys still accepted. |
| JWT verification | `jose` + JWKS `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`, issuer `<url>/auth/v1`, audience `authenticated`. HS256 fallback via `SUPABASE_JWT_SECRET` (legacy projects, local tests). |
| Data API grants | Supabase now requires explicit grants for new tables → migrations grant `authenticated` (narrow) and `service_role` explicitly. |
| Postgres | Supabase runs PG17; migrations are kept PG14-compatible so they run against local PostgreSQL for tests. |
| Rate limiting | Workers Rate Limiting binding (optional; free-plan availability unverified) with in-memory fallback. **Authoritative AI cost control = database quota** (`reserve_ai_call`, advisory-locked, per-workspace + global daily limits). |
| Worker limits | Free plan: 10 ms CPU/request (network wait excluded), 50 subrequests, 100k req/day → aggregates computed in SQL RPCs, lean handlers. |
| Auth email | Supabase built-in SMTP sends ~2 emails/hour → docs recommend custom SMTP or disabling email confirmation for the demo project. |
| n8n | v2.x requires Node ≥ 24. Gemini via HTTP Request + Header Auth (`x-goog-api-key`); Supabase via Header Auth (`apikey: sb_secret_…`); Slack URL via `$env` (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). |
| Frontend | Vite 8, React 19, TS 7, Tailwind 4, shadcn (base-nova / Base UI), TanStack Query 5, React Router 7, Recharts 3. |

## 3. Repository layout

```
apps/web          React SPA (Cloudflare Pages)
apps/api          Hono API (Cloudflare Worker)
packages/shared   Zod schemas, enums, scoring rules, AI prompt/contract, API types
supabase/         migrations, seed.sql, local test shim
n8n/              importable workflow JSON + setup notes
e2e/              Playwright tests
docs/             architecture, API, deployment, demo checklist
scripts/          local DB reset, seed generation
```

## 4. Phase tracker

Last updated 2026-10-31 (counts from commands run that day).

| Phase | Item | Status |
|---|---|---|
| 1 | Environment inspection, research, architecture | Done |
| 2 | Monorepo, TS, Tailwind/shadcn, shared contracts, env examples | Done |
| 2 | Migrations (schema, RLS, grants, quota RPC, analytics RPCs) applied to local PG + SQL smoke test | Done |
| 3 | Auth (Supabase Auth + Worker JWT verification), lead CRUD, dashboard, lead detail | Done locally (JWT path tested with local HS256 tokens; real Supabase Auth not yet exercised) |
| 4 | Gemini integration, scoring, AI qualification UI | Done with stubbed Gemini responses; **no real Gemini call yet** (needs owner's key) |
| 5 | Slack, executions/retries | Done with stubbed Slack; no real Slack message sent yet |
| 5 | n8n workflow | Built; JSON validation + 46 Code-node tests pass. Executed in local n8n 2.45.7 (Docker) with `AI_ENABLED=false`: new/duplicate/honeypot/invalid/no-token cases verified against PostgREST. Gemini/Slack branches pending keys |
| 6 | Typecheck, lint, unit (shared 43, API 62, web 40), DB isolation (120), API integration (35) | Done |
| 6 | Playwright E2E | In progress (preview spec being written; not yet run in this tracker) |
| 7 | Cloudflare/Supabase deployment | Blocked on owner's Cloudflare, Supabase and Gemini accounts; guide in DEPLOYMENT.md (not yet executed) |
| 8 | README, ARCHITECTURE, DEPLOYMENT, DEMO-CHECKLIST, LICENSE | Done |
| 8 | Screenshots (`docs/screenshots/`) | Pending (referenced by README; not captured yet) |
| 8 | Independent code review, public GitHub push | Pending |
