# Setting up keys

Moved to **[DEPLOYMENT.md](DEPLOYMENT.md)**: sections 1–3 cover Supabase, Gemini and the encryption key, section 4 the two local files (`apps/api/.dev.vars`, `apps/web/.env.local`), and section 5 Cloudflare.

Slack: create a Slack app → *Incoming Webhooks* → add to a channel → paste the `https://hooks.slack.com/services/...` URL into the app's **Integrations** page (stored encrypted), not into a file.

Never paste secrets into chat, issues or commits; both local files are git-ignored.
