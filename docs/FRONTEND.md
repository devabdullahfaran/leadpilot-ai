# LeadPilot AI — Frontend guide

`apps/web`: Vite 8 · React 19 · TS 7 · Tailwind 4 · shadcn/ui **base-nova on Base UI** (use `render`, not `asChild`) · TanStack Query 5 · React Router 7 (`import from 'react-router'`).

## Structure

```
src/
  app/            app.tsx (providers), router.tsx, root-layout.tsx, query-client.ts,
                  data-mode.ts (+provider), workspace.ts (+provider)
  auth/           AuthProvider, useAuth, ProtectedRoute, safeNextPath
  api/            query keys + one TanStack hook per endpoint (import from '@/api')
  lib/            env, supabase (null if unconfigured), api-client, format, storage, utils (cn)
  components/ui/  shadcn primitives (generated; read before use)
  components/app/ shared product components (import from '@/components/app')
  components/layout/ AppShell, sidebar, topbar, preview banner, AuthLayout, nav config
  pages/          auth/*, not-found, route-error, and one folder per page area
```

Page modules export a **named** component (`DashboardPage`, `LeadsPage`, `LeadDetailPage` in `leads/lead-detail.tsx`, …); the router lazy-loads them. The shell already provides padding and max width — a page renders `<div className="space-y-6"><PageHeader …/>…</div>`.

## Data mode

The same pages are mounted at `/…` (signed-in, `mode: 'user'`) and `/preview/…` (no auth, `mode: 'demo'`, read-only, API base `/api/v1/demo`).

* `useDataMode()` → `{ mode, basePath: '' | '/preview', readOnly }`.
* `useAppLink()` → `link('/leads/123')` gives `/leads/123` or `/preview/leads/123`. **Never hard-code app paths.**
* `useWorkspace()` → `{ workspace, workspaces, role, setActiveWorkspace }` (null workspace in preview).
* Query keys start with `['lp', mode, workspaceId]`, so preview, user and per-workspace data never mix. Switching workspace invalidates `['lp','user']`.
* Every mutating control goes inside `<ReadOnlyGuard action="create leads" minRole="member">`. In preview it is disabled with the tooltip "Sign in to create leads"; without the role it explains the required role. `useMutationGuard()` gives the same answer for forms. Mutation hooks also refuse to run in preview (local `read_only` error, no request).

## Hooks (`@/api`)

Queries: `useSession`, `useHealth`, `useDashboardSummary`, `useAnalytics(days)`, `useLeads(params)`, `useLead(id)`, `useLeadActivities(id)`, `useLeadQualifications(id)`, `useDuplicateCheck(params, enabled)` (debounce in the caller), `useWorkflowOverview`, `useExecutions(params)`, `useExecution(id)`, `useIntegrations`, `useAiUsage`, `useAiSettings`, `useMembers`.
`{ data: T[] }` responses are unwrapped to `T[]`; paginated ones return `Paginated<T>` and keep the previous page while loading.

Mutations: `useCreateLead`, `useUpdateLead({id,data})`, `useDeleteLead(id)`, `useAddNote({leadId,body})`, `useQualifyLead(leadId)`, `useOverrideQualification({leadId,data})`, `useRetryExecution({executionId,leadId?})`, `useSaveSlack`, `useDeleteSlack`, `useTestSlack`, `useRotateIntakeKey`, `useSaveAiSettings`, `useUpdateWorkspace`, `useUpdateProfile`, `useLoadSampleData`, `useClearSampleData`. They invalidate the affected keys themselves (qualify/retry also refresh on failure, since the failed run is recorded). Pages show toasts: `toast.success(...)` / `toast.error(errorMessage(err))`.

Errors are `ApiClientError { status, code, message, details, requestId, retryAfter, fieldErrors, isRetryable }`. Branch on `code`, never on message. Queries retry only network/5xx; a 401 in user mode signs out and redirects to `/login?expired=1`. `POST /intake/:workspaceId` has no hook on purpose: website forms and n8n call it with an intake key.

## Components (`@/components/app`)

`PageHeader` (title, description, actions, meta) · `StatCard` (label, value, `hint` = metric definition, `delta` only if the API provides it) · `EmptyState` (always offer a next action) · `ErrorState` (message + request ID + retry) · `PriorityBadge` · `LeadStatusBadge` · `QualificationStatusBadge` · `ExecutionStatusBadge` · `EngineBadge` (Worker / n8n · self-hosted) · `SampleBadge` (show on every `isSample` record) · `RoleBadge` · `ScoreBadge` / `ScoreBar` (pass workspace thresholds when known) · `ConfirmDialog` · `ReadOnlyGuard` · `DataPagination` · `CopyButton` · `RelativeTime` · `AiDisclaimer` (next to any AI score, summary or recommendation) · `FormField` · `usePageTitle(name)` (dynamic breadcrumb/document title, e.g. a lead's name). Tone/label maps live in `badge-specs.tsx` for filters and legends.

Formatters (`@/lib/format`): `formatDate`, `formatShortDate`, `formatDateTime`, `formatRelativeTime`, `formatDuration` (ms → "1.2 s"), `formatNumber`, `formatPercent` (ratio 0–1), `formatEnumLabel` ('website_form' → 'Website form'), `pluralize`, `initials`.

## Design conventions

* Light theme, neutral surfaces, one blue accent (`primary`). Status tones: `success`, `warning`, `danger`, `info` (`bg-success/10 text-success`); priority high/medium/low = green/amber/gray so red always means failure. Colour is always paired with text or an icon.
* Charts use `chart-1…5` (blue, orange, aqua, violet, yellow), validated for colour-blind separation in light and dark. Aqua and yellow are under 3:1 against white, so charts that use them need a legend plus direct labels or a table view. Use slots in order, never more than five series.
* Tables are 13–14px with `tabular-nums` (or the `tabular` utility); spacing follows the 4/8px scale; borders are 1px with `shadow-xs` at most.
* Loading states use `Skeleton`; never invent numbers: show "—" when a value is missing.
* Accessibility: every icon-only button has `aria-label`; form controls go through `FormField`; keep focus rings.
