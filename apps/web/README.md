# @leadpilot/web

React SPA for LeadPilot AI (Vite 8, React 19, TypeScript 7, Tailwind CSS 4, shadcn/ui on Base UI,
TanStack Query 5, React Router 7). Deployed to Cloudflare Pages.

## Run

```sh
cp apps/web/.env.example apps/web/.env.local   # optional: fill in Supabase to enable sign-in
npm run dev:web                                 # http://localhost:5173
```

Without Supabase values the auth pages explain that sign-in is unavailable, and the read-only
portfolio preview at `/preview/dashboard` still works (it reads `/api/v1/demo/*` from `VITE_API_URL`).

## Scripts (from `apps/web`)

| Command | Purpose |
|---|---|
| `npx tsc -b` | Typecheck |
| `npx oxlint src` | Lint |
| `npx vitest run` | Unit tests (jsdom) |
| `npx vite build` | Production build to `dist/` |

Conventions, hooks and shared components are documented in [`docs/FRONTEND.md`](../../docs/FRONTEND.md).
