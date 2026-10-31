# Deploying LeadPilot AI (free tiers)

> **Status:** this guide has **not yet been executed end to end**; the project has not been deployed (_pending deployment_ on the owner's Cloudflare, Supabase and Gemini accounts). Commands are standard Wrangler / Supabase dashboard steps; adjust if the UIs have changed.

Target: API on Cloudflare Workers (`<worker>.<subdomain>.workers.dev`), web on Cloudflare Pages (`<project>.pages.dev`), Supabase Postgres + Auth, Gemini free tier. Secrets never go into git, chat or the browser bundle.

## 1. Supabase

1. Create a free project at <https://supabase.com/dashboard>. Save the database password.
2. **Schema:** *SQL Editor* → run each file's contents in this order:
   1. `supabase/migrations/20261031000100_core_schema.sql`
   2. `supabase/migrations/20261031000200_security.sql`
   3. `supabase/migrations/20261031000300_analytics.sql`
   4. `supabase/seed.sql` (synthetic preview workspace; safe to re-run)
3. **Keys:** *Project Settings → API Keys*: Project URL (`https://<ref>.supabase.co`), **publishable** key (`sb_publishable_…`, browser-safe), **secret** key (`sb_secret_…`, server only, bypasses RLS). Projects with only legacy keys: use `anon` as publishable and `service_role` as secret; if tokens are still signed with the legacy JWT secret, also copy *JWT Settings → JWT Secret* (`SUPABASE_JWT_SECRET`).
4. **Auth URLs:** *Authentication → URL Configuration*: Site URL `http://localhost:5173` for now; Redirect URLs `http://localhost:5173/reset-password`. Updated in step 7.
5. **Email:** built-in SMTP sends only about 2 emails/hour. For a demo, turn off *Authentication → Sign In / Providers → Email → Confirm email*, or configure custom SMTP (*Authentication → Emails → SMTP Settings*).

## 2. Gemini

1. <https://aistudio.google.com/apikey> → **Create API key** (no billing needed).
2. Check your limits in AI Studio (*Rate limit*) and keep `AI_DAILY_LIMIT_*` below them.
3. ⚠️ Free-tier prompts may be used by Google to improve products, and the free tier may not be offered to users in the EEA, Switzerland or UK. Use synthetic data only.

## 3. Encryption key

```bash
openssl rand -base64 32     # ENCRYPTION_KEY: encrypts stored Slack webhook URLs (AES-256-GCM)
```

Keep it safe: losing or changing it makes stored Slack webhooks undecryptable (re-enter them in Integrations).

## 4. Local full-mode check (recommended before deploying)

`apps/api/.dev.vars` (from `.dev.vars.example`) and `apps/web/.env.local` (from `.env.example`):

```dotenv
# apps/api/.dev.vars
ENVIRONMENT=development
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
# SUPABASE_JWT_SECRET=   # only for legacy HS256 projects
ALLOWED_ORIGINS=http://localhost:5173
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
AI_ENABLED=true
AI_DAILY_LIMIT_GLOBAL=150
AI_DAILY_LIMIT_PER_WORKSPACE=25
ENCRYPTION_KEY=<openssl output>
```

```dotenv
# apps/web/.env.local
VITE_API_URL=http://localhost:8787
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Then `npm run dev:api` and `npm run dev:web`, open <http://localhost:5173>, sign up, create a lead and run AI.

## 5. Cloudflare account & API Worker

1. Sign up at <https://dash.cloudflare.com/sign-up>; open *Workers & Pages* once so a `<subdomain>.workers.dev` is assigned.
2. Log in Wrangler (from the repo):
   ```bash
   cd apps/api
   npx wrangler login
   npx wrangler whoami
   ```
3. **Worker name:** `name` in `apps/api/wrangler.jsonc` is `leadpilot-api`. Check *Workers & Pages* for an existing Worker of that name in your account; change it if needed. The URL becomes `https://<name>.<subdomain>.workers.dev`.
4. **Non-secret vars:** edit `vars` in `apps/api/wrangler.jsonc`:
   - `SUPABASE_URL` → `https://<ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` → `sb_publishable_…`
   - `ALLOWED_ORIGINS` → your Pages URL (comma-separated if several; you can set it after step 6)
   - leave `ENVIRONMENT=production`; tune `AI_ENABLED`, `AI_DAILY_LIMIT_GLOBAL`, `AI_DAILY_LIMIT_PER_WORKSPACE`, `GEMINI_MODEL`
5. **Secrets** (prompted interactively, never echoed into files):
   ```bash
   npx wrangler secret put SUPABASE_SECRET_KEY
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put ENCRYPTION_KEY
   # only for legacy HS256 Supabase projects:
   npx wrangler secret put SUPABASE_JWT_SECRET
   ```
   (If `secret put` says the Worker does not exist yet, run `npx wrangler deploy` first, then put the secrets.)
6. **Rate limit bindings:** `wrangler.jsonc` declares a `ratelimits` block. If deploy rejects it on your plan, delete the block; the API falls back to an in-memory limiter.
7. **Deploy:**
   ```bash
   npx wrangler deploy
   curl https://<name>.<subdomain>.workers.dev/api/v1/health
   ```
   Expect `{"status":"ok","version":"0.1.0","environment":"production",...}`.

## 6. Web app on Cloudflare Pages

```bash
# from the repo root
VITE_API_URL=https://<name>.<subdomain>.workers.dev \
VITE_SUPABASE_URL=https://<ref>.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
npm run build

cd apps/api   # reuse the local wrangler install
npx wrangler pages project create <pages-name> --production-branch main
npx wrangler pages deploy ../web/dist --project-name <pages-name>
```

`VITE_*` values are baked into the bundle at build time; rebuild and redeploy after changing them. Pages serves `index.html` for unknown paths when no `404.html` exists, so client routes like `/preview/dashboard` work.

## 7. Wire the URLs together

1. Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to `https://<pages-name>.pages.dev` (plus any custom domain) and run `npx wrangler deploy` again.
2. Supabase *Authentication → URL Configuration*: Site URL `https://<pages-name>.pages.dev`; add redirect `https://<pages-name>.pages.dev/reset-password`.

## 8. Smoke tests

| Check | How | Expected |
|---|---|---|
| API health | `curl https://<worker>/api/v1/health` | `status: ok` |
| Preview | open `https://<pages>/preview/dashboard` | sample dashboard, no sign-in |
| Sign up | `/register` | lands on dashboard with your own (empty) workspace |
| Create lead | Leads → New lead | lead listed; duplicate email → duplicate warning |
| Run AI | lead detail → Qualify | score, category, reasoning; new row under Workflows and Integrations → AI usage |
| Slack | Integrations → paste webhook → Send test | message in channel; `slack_notification` execution |
| Intake | Integrations → rotate intake key, then `curl -X POST https://<worker>/api/v1/intake/<workspaceId> -H 'X-Intake-Key: lpk_…' -H 'Content-Type: application/json' -d '{"name":"Test","email":"test@example.com","source":"website_form","message":"Need a quote"}'` | `201` with lead id |

Record what actually happened; do not update README status claims until each check passes.

## 9. Playwright against the deployment

```bash
E2E_BASE_URL=https://<pages-name>.pages.dev npm run test:e2e
# signed-in specs (if present) also need a dedicated test account:
E2E_BASE_URL=https://<pages-name>.pages.dev E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e
```

Use a throwaway account. Specs that run AI consume real Gemini quota.

## 10. Troubleshooting CORS

- Browser error "blocked by CORS policy" on `/api/v1/*`: the page origin must exactly match an entry in `ALLOWED_ORIGINS` (scheme + host; a trailing slash in the setting is ignored). Redeploy the Worker after editing.
- Preview deployments get URLs like `https://<hash>.<pages-name>.pages.dev`; add them explicitly if you test on them.
- `/api/v1/intake/*` accepts any origin by design (the intake key is the credential).
- `401` on every call after sign-in: check `SUPABASE_URL` matches the project the web app signs into; legacy projects need `SUPABASE_JWT_SECRET`.

## 11. Free-tier limits & pausing

- Workers: 100,000 requests/day, 10 ms CPU per request, 50 subrequests per request.
- Supabase: 500 MB database; **projects pause after 7 days of inactivity**. Restore from the dashboard; the preview shows API errors while paused.
- Gemini: limits per model in AI Studio; daily quota errors are not retried.

## 12. Cost-safety knobs

- `AI_ENABLED=false` in `wrangler.jsonc` vars (then `npx wrangler deploy`) stops all Gemini calls immediately.
- `AI_DAILY_LIMIT_GLOBAL` / `AI_DAILY_LIMIT_PER_WORKSPACE`: enforced in the database before each call.
- Per-workspace AI on/off and auto-qualify on intake: Settings → AI.
- Rate limits: `ratelimits` block (or the in-memory fallback in `apps/api/src/middleware/rate-limit.ts`).
- Everything here runs on free plans; no billing account is required for Cloudflare, Supabase or the Gemini free tier.

## 13. Rotating secrets

| Secret | Rotate |
|---|---|
| Supabase secret key | create a new secret key in Supabase → `npx wrangler secret put SUPABASE_SECRET_KEY` → revoke the old one |
| Gemini key | new key in AI Studio → `npx wrangler secret put GEMINI_API_KEY` → delete the old one |
| `ENCRYPTION_KEY` | `npx wrangler secret put ENCRYPTION_KEY`, then re-enter Slack webhooks (old ciphertext can no longer be decrypted) |
| Intake key | Integrations → rotate (old key stops working immediately) |
| Slack webhook | regenerate in Slack, save in Integrations |

## 14. GitHub Actions (optional, not set up)

No CI workflow is included. A minimal pipeline would run `npm ci && npm run check` on pushes; deploying from CI would need a scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` stored as repository secrets.
