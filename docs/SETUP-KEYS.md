# Setting up keys for local development

Everything below is on free plans. Secrets go only into the two git-ignored files shown at the end. Never paste them into chat, issues or commits.

## 1. Supabase (database + auth)

1. Create a free project at <https://supabase.com/dashboard> (any region; note the database password somewhere safe).
2. **Apply the schema.** Open *SQL Editor* and run each file's contents **in this order**:
   1. `supabase/migrations/20261031000100_core_schema.sql`
   2. `supabase/migrations/20261031000200_security.sql`
   3. `supabase/migrations/20261031000300_analytics.sql`
   4. `supabase/seed.sql` (portfolio preview sample data; safe to re-run)
3. **Keys:** *Project Settings → API Keys*. Copy:
   * Project URL (`https://<ref>.supabase.co`)
   * **Publishable** key (`sb_publishable_…`): safe for the browser.
   * **Secret** key (`sb_secret_…`): server only. It bypasses RLS.
   * If your project only shows legacy `anon` / `service_role` keys, those also work: use `anon` as the publishable key and `service_role` as the secret key. If it still signs tokens with the legacy JWT secret, also copy *JWT Settings → JWT Secret* into `SUPABASE_JWT_SECRET`.
4. **Auth URLs:** *Authentication → URL Configuration*:
   * Site URL: `http://localhost:5173` (change to your `*.pages.dev` URL after deploying).
   * Redirect URLs: add `http://localhost:5173/reset-password` (and later `https://<your-pages>.pages.dev/reset-password`).
5. **Email confirmation:** the built-in email sender is limited to about 2 emails per hour. For a demo project, either turn off *Authentication → Sign In / Providers → Email → Confirm email*, or configure custom SMTP (*Authentication → Emails → SMTP Settings*, e.g. a free Resend or Brevo account).

## 2. Google Gemini

1. Go to <https://aistudio.google.com/apikey> and click **Create API key**. Free tier, no billing needed.
2. Your daily and per-minute limits are shown in AI Studio under *Rate limit*. Keep `AI_DAILY_LIMIT_*` at or below them.
3. ⚠️ On the free tier, Google may use prompts to improve its products. Use synthetic data only, never real customer data. LeadPilot sends only the email **domain**, company, title, website, source and message: no name, email or phone.

## 3. Encryption key (protects stored Slack webhook URLs)

```bash
openssl rand -base64 32
```

## 4. Slack (optional)

Create a Slack app → *Incoming Webhooks* → *Add New Webhook to Workspace* → pick a channel → copy the `https://hooks.slack.com/services/...` URL. You enter it in the app's **Integrations** page (it is stored encrypted), **not** in a file.

## 5. Put the values in these files

`apps/api/.dev.vars` (copy from `apps/api/.dev.vars.example`):

```dotenv
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
ENCRYPTION_KEY=<output of openssl rand -base64 32>
```

`apps/web/.env.local` (copy from `apps/web/.env.example`):

```dotenv
VITE_API_URL=http://localhost:8787
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## 6. Cloudflare (for deployment)

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Open *Workers & Pages* once so Cloudflare assigns your `<subdomain>.workers.dev`.
3. Run `npx wrangler login` inside `apps/api` (opens a browser to authorize Wrangler on your machine).

Once these are in place, tell Claude Code; it will run the local stack against your project and then deploy, asking before each step that creates cloud resources.
