-- LeadPilot AI: full setup (3 migrations + demo seed). Paste into Supabase SQL Editor and click Run.

-- ===== supabase/migrations/20261031000100_core_schema.sql =====
-- LeadPilot AI — core schema
-- Workspace-scoped CRM tables, workflow execution log, integrations and AI usage accounting.
-- Kept compatible with PostgreSQL 14+ so the same file runs on Supabase and in local integration tests.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles, workspaces, membership
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  email text check (email is null or char_length(email) <= 254),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  -- The single public, read-only portfolio preview workspace. It never has members.
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workspaces_single_demo_idx on public.workspaces (is_demo) where is_demo;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Normalized copies used for duplicate detection. Generated, so they cannot drift or be forged.
  email_normalized text generated always as (lower(btrim(email))) stored,
  phone text check (phone is null or char_length(phone) <= 40),
  phone_normalized text generated always as (
    case
      when length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 7
        then (case when btrim(phone) like '+%' then '+' else '' end) || regexp_replace(phone, '\D', '', 'g')
    end
  ) stored,
  company text not null check (char_length(company) between 1 and 160),
  job_title text check (job_title is null or char_length(job_title) <= 120),
  website text check (website is null or char_length(website) <= 300),
  source text not null default 'manual' check (
    source in ('website_form', 'landing_page', 'referral', 'linkedin', 'email', 'phone', 'event', 'manual', 'api', 'n8n', 'other')
  ),
  message text not null check (char_length(message) between 1 and 5000),
  status text not null default 'new' check (
    status in ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'disqualified')
  ),

  -- Current qualification (latest AI result or manual override). History lives in lead_qualifications.
  score smallint check (score between 0 and 100),
  priority text check (priority in ('high', 'medium', 'low')),
  category text check (category is null or char_length(category) <= 60),
  ai_summary text check (ai_summary is null or char_length(ai_summary) <= 400),
  ai_reasoning text check (ai_reasoning is null or char_length(ai_reasoning) <= 1200),
  recommended_action text check (recommended_action is null or char_length(recommended_action) <= 300),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  qualification_status text not null default 'pending' check (
    qualification_status in ('pending', 'processing', 'completed', 'needs_review', 'failed', 'skipped')
  ),
  qualification_error text check (qualification_error is null or char_length(qualification_error) <= 1000),
  last_qualified_at timestamptz,

  owner_id uuid references public.profiles (id) on delete set null,
  is_sample boolean not null default false,
  submission_count integer not null default 1 check (submission_count >= 1),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Target for composite foreign keys that pin child rows to the lead's workspace.
  unique (id, workspace_id)
);

-- One lead per email per workspace. Repeat submissions update the existing lead.
create unique index leads_workspace_email_key on public.leads (workspace_id, email_normalized);
create index leads_workspace_created_idx on public.leads (workspace_id, created_at desc);
create index leads_workspace_status_idx on public.leads (workspace_id, status);
create index leads_workspace_priority_idx on public.leads (workspace_id, priority);
create index leads_workspace_qualification_idx on public.leads (workspace_id, qualification_status);
create index leads_workspace_phone_idx on public.leads (workspace_id, phone_normalized) where phone_normalized is not null;
create index leads_workspace_company_idx on public.leads (workspace_id, lower(company));
create index leads_owner_idx on public.leads (owner_id) where owner_id is not null;

-- ---------------------------------------------------------------------------
-- Workflow executions (Worker pipeline and n8n write-backs)
-- ---------------------------------------------------------------------------

create table public.workflow_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  workflow_key text not null check (workflow_key in ('lead_intake', 'lead_qualification', 'slack_notification')),
  engine text not null default 'worker' check (engine in ('worker', 'n8n')),
  trigger text not null check (trigger in ('web_form', 'api', 'manual', 'retry', 'n8n_webhook', 'test')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  attempt integer not null default 1 check (attempt between 1 and 20),
  retry_of_id uuid references public.workflow_executions (id) on delete set null,
  error_code text check (error_code is null or char_length(error_code) <= 60),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  -- Response body replayed for repeated idempotent intake requests.
  result jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  is_sample boolean not null default false,
  check (finished_at is null or finished_at >= started_at),
  check ((status = 'running') = (finished_at is null))
);
create unique index workflow_executions_idempotency_key on public.workflow_executions (workspace_id, idempotency_key)
  where idempotency_key is not null;
create index workflow_executions_workspace_started_idx on public.workflow_executions (workspace_id, started_at desc);
create index workflow_executions_workspace_status_idx on public.workflow_executions (workspace_id, status);
create index workflow_executions_lead_idx on public.workflow_executions (lead_id) where lead_id is not null;

-- ---------------------------------------------------------------------------
-- Qualification history and activity timeline
-- ---------------------------------------------------------------------------

create table public.lead_qualifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid not null,
  source text not null check (source in ('ai', 'manual')),
  score smallint not null check (score between 0 and 100),
  priority text not null check (priority in ('high', 'medium', 'low')),
  category text check (category is null or char_length(category) <= 60),
  summary text check (summary is null or char_length(summary) <= 400),
  reasoning text check (reasoning is null or char_length(reasoning) <= 1200),
  recommended_action text check (recommended_action is null or char_length(recommended_action) <= 300),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),
  adjustments jsonb not null default '[]'::jsonb check (jsonb_typeof(adjustments) = 'array'),
  model text check (model is null or char_length(model) <= 80),
  prompt_version text check (prompt_version is null or char_length(prompt_version) <= 40),
  override_reason text check (override_reason is null or char_length(override_reason) <= 1000),
  execution_id uuid references public.workflow_executions (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references public.leads (id, workspace_id) on delete cascade,
  check (source <> 'manual' or override_reason is not null),
  check (source <> 'ai' or model is not null)
);
create index lead_qualifications_lead_idx on public.lead_qualifications (lead_id, created_at desc);
create index lead_qualifications_workspace_idx on public.lead_qualifications (workspace_id, created_at desc);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid not null,
  type text not null check (
    type in (
      'lead_created', 'lead_updated', 'status_changed', 'owner_changed', 'note_added',
      'qualification_started', 'qualification_completed', 'qualification_failed', 'qualification_override',
      'duplicate_submission', 'notification_sent', 'notification_failed'
    )
  ),
  body text check (body is null or char_length(body) <= 4000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  actor_id uuid references public.profiles (id) on delete set null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references public.leads (id, workspace_id) on delete cascade,
  check (type <> 'note_added' or body is not null)
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);
create index lead_activities_workspace_idx on public.lead_activities (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integrations and notifications
-- ---------------------------------------------------------------------------

-- Non-secret integration configuration, readable by workspace members.
create table public.integration_settings (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('slack', 'ai', 'intake')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);

-- Secret material (encrypted Slack webhook URL, hashed intake key).
-- RLS is enabled with NO policies and client roles have no grants: only the server's service role can read it.
create table public.integration_secrets (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('slack', 'intake')),
  -- AES-GCM ciphertext produced by the Worker ("v1.<iv>.<ciphertext>", base64url). Null for hashed secrets.
  ciphertext text check (ciphertext is null or char_length(ciphertext) <= 4000),
  -- SHA-256 hex digest for secrets that only need verification (intake keys).
  secret_hash text check (secret_hash is null or secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider),
  check (ciphertext is not null or secret_hash is not null)
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  execution_id uuid references public.workflow_executions (id) on delete set null,
  channel text not null check (channel in ('slack', 'email')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text check (error is null or char_length(error) <= 1000),
  -- Summary of what was sent (lead name, score). Never contains credentials.
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index notification_events_workspace_idx on public.notification_events (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- AI usage accounting (cost protection)
-- ---------------------------------------------------------------------------

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  model text not null check (char_length(model) <= 80),
  -- 'pending' rows are quota reservations made before the outbound call.
  status text not null check (
    status in ('pending', 'success', 'invalid_response', 'error', 'timeout', 'rejected_quota', 'rejected_disabled')
  ),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  created_at timestamptz not null default now()
);
create index ai_usage_events_created_idx on public.ai_usage_events (created_at desc);
create index ai_usage_events_workspace_created_idx on public.ai_usage_events (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger leads_set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
create trigger integration_settings_set_updated_at before update on public.integration_settings
  for each row execute function public.set_updated_at();
create trigger integration_secrets_set_updated_at before update on public.integration_secrets
  for each row execute function public.set_updated_at();

-- A lead may only be assigned to a member of its own workspace.
create or replace function public.enforce_lead_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = new.workspace_id and m.user_id = new.owner_id
  ) then
    raise exception 'owner must be a member of the lead''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger leads_owner_membership before insert or update of owner_id, workspace_id on public.leads
  for each row execute function public.enforce_lead_owner_membership();

-- Leads never move between workspaces.
create or replace function public.prevent_workspace_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id then
    raise exception 'workspace_id is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger leads_workspace_immutable before update of workspace_id on public.leads
  for each row execute function public.prevent_workspace_change();

-- Rows that reference a lead through a nullable FK must belong to the lead's workspace.
create or replace function public.enforce_lead_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.leads l where l.id = new.lead_id and l.workspace_id = new.workspace_id
  ) then
    raise exception 'lead belongs to a different workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger workflow_executions_lead_workspace before insert or update of lead_id, workspace_id on public.workflow_executions
  for each row execute function public.enforce_lead_workspace();
create trigger notification_events_lead_workspace before insert or update of lead_id, workspace_id on public.notification_events
  for each row execute function public.enforce_lead_workspace();
create trigger ai_usage_events_lead_workspace before insert or update of lead_id, workspace_id on public.ai_usage_events
  for each row execute function public.enforce_lead_workspace();

-- ===== supabase/migrations/20261031000200_security.sql =====
-- LeadPilot AI — authorization: RLS helpers, policies, grants, signup provisioning, AI quota reservation.
--
-- Access model
--   * The browser only talks to Supabase Auth. All data access goes through the Worker API.
--   * The Worker reads (and performs user-level writes) with the caller's JWT, so RLS below is enforced
--     even if an API handler forgets a check.
--   * System writes (AI results, execution logs, usage accounting, notifications, secrets) are made with the
--     service role after the Worker has verified the caller's workspace role.

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so policies on workspace_members do not recurse)
-- ---------------------------------------------------------------------------

create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'owner' then 3 when 'admin' then 2 when 'member' then 1 when 'viewer' then 0 else -1 end;
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_workspace_role(p_workspace_id uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and public.role_rank(m.role) >= public.role_rank(p_min_role)
  );
$$;

create or replace function public.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.leads enable row level security;
alter table public.lead_qualifications enable row level security;
alter table public.lead_activities enable row level security;
alter table public.workflow_executions enable row level security;
alter table public.integration_settings enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.notification_events enable row level security;
alter table public.ai_usage_events enable row level security;

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants broad table privileges to anon/authenticated by default;
-- narrow them so RLS is not the only line of defence.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on
  public.profiles, public.workspaces, public.workspace_members, public.leads, public.lead_qualifications,
  public.lead_activities, public.workflow_executions, public.integration_settings, public.notification_events,
  public.ai_usage_events
to authenticated;

grant update (full_name) on public.profiles to authenticated;
grant update (name) on public.workspaces to authenticated;

-- Users may write basic CRM fields only. AI result columns, is_sample and counters are server-managed.
grant insert (workspace_id, name, email, phone, company, job_title, website, source, message, status, owner_id, created_by)
  on public.leads to authenticated;
grant update (name, email, phone, company, job_title, website, source, message, status, owner_id)
  on public.leads to authenticated;
grant delete on public.leads to authenticated;

grant insert (workspace_id, lead_id, type, body, actor_id) on public.lead_activities to authenticated;

-- Supabase no longer exposes new tables to the Data API automatically (explicit grants are required since
-- 2026), so the server's service role is granted explicitly as well. It bypasses RLS.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

grant execute on function public.role_rank(text) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, text) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace_with(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy workspaces_update_admin on public.workspaces for update to authenticated
  using (public.has_workspace_role(id, 'admin')) with check (public.has_workspace_role(id, 'admin'));

create policy workspace_members_select on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy leads_select on public.leads for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy leads_insert on public.leads for insert to authenticated
  with check (public.has_workspace_role(workspace_id, 'member') and created_by = (select auth.uid()));
create policy leads_update on public.leads for update to authenticated
  using (public.has_workspace_role(workspace_id, 'member'))
  with check (public.has_workspace_role(workspace_id, 'member'));
create policy leads_delete on public.leads for delete to authenticated
  using (public.has_workspace_role(workspace_id, 'admin'));

create policy lead_qualifications_select on public.lead_qualifications for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy lead_activities_select on public.lead_activities for select to authenticated
  using (public.is_workspace_member(workspace_id));
-- Users may add notes in their own name; every other activity type is written by the server.
create policy lead_activities_insert_note on public.lead_activities for insert to authenticated
  with check (
    type = 'note_added'
    and actor_id = (select auth.uid())
    and public.has_workspace_role(workspace_id, 'member')
  );

create policy workflow_executions_select on public.workflow_executions for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy integration_settings_select on public.integration_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy notification_events_select on public.notification_events for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy ai_usage_events_select on public.ai_usage_events for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- integration_secrets: intentionally no policies.

-- ---------------------------------------------------------------------------
-- Signup provisioning: profile + personal workspace (owner)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  v_workspace_id uuid;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, left(v_name, 120), new.email);

  insert into public.workspaces (name, slug, created_by)
  values (
    left(coalesce(v_name, split_part(coalesce(new.email, 'My'), '@', 1)), 60) || '''s workspace',
    'ws-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    new.id
  )
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- AI quota reservation (service role only)
-- ---------------------------------------------------------------------------

-- Atomically checks today's (UTC) usage against the per-workspace and global daily limits and, when there is
-- room, inserts a 'pending' usage row that the Worker later finalizes. Serialized with an advisory lock so
-- concurrent requests cannot overshoot the limits. Rejections are recorded too, for visibility.
create or replace function public.reserve_ai_call(
  p_workspace_id uuid,
  p_user_id uuid,
  p_lead_id uuid,
  p_model text,
  p_workspace_limit integer,
  p_global_limit integer
)
returns table (reservation_id uuid, allowed boolean, reason text, workspace_used integer, global_used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_ws integer;
  v_global integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('leadpilot.ai_quota'));

  select count(*) into v_global
  from public.ai_usage_events
  where created_at >= v_day_start and status not in ('rejected_quota', 'rejected_disabled');

  select count(*) into v_ws
  from public.ai_usage_events
  where workspace_id = p_workspace_id and created_at >= v_day_start
    and status not in ('rejected_quota', 'rejected_disabled');

  if v_global >= p_global_limit or v_ws >= p_workspace_limit then
    insert into public.ai_usage_events (workspace_id, user_id, lead_id, model, status, error_code)
    values (
      p_workspace_id, p_user_id, p_lead_id, p_model, 'rejected_quota',
      case when v_global >= p_global_limit then 'global_daily_limit' else 'workspace_daily_limit' end
    );
    return query select null::uuid, false,
      case when v_global >= p_global_limit then 'global_daily_limit' else 'workspace_daily_limit' end,
      v_ws, v_global;
    return;
  end if;

  insert into public.ai_usage_events (workspace_id, user_id, lead_id, model, status)
  values (p_workspace_id, p_user_id, p_lead_id, p_model, 'pending')
  returning id into v_id;

  return query select v_id, true, null::text, v_ws + 1, v_global + 1;
end;
$$;

revoke all on function public.reserve_ai_call(uuid, uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_call(uuid, uuid, uuid, text, integer, integer) to service_role;

-- ===== supabase/migrations/20261031000300_analytics.sql =====
-- LeadPilot AI — dashboard and analytics aggregates.
-- SECURITY INVOKER: when called with a user's JWT, RLS limits every query to that user's workspaces,
-- so passing another workspace's id returns zeros rather than leaking data.

create or replace function public.dashboard_summary(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with l as (
    select status, priority, qualification_status, is_sample
    from public.leads
    where workspace_id = p_workspace_id
  ),
  statuses(status, ord) as (
    values ('new', 1), ('contacted', 2), ('qualified', 3), ('proposal', 4), ('won', 5), ('lost', 6), ('disqualified', 7)
  ),
  ex as (
    select status
    from public.workflow_executions
    where workspace_id = p_workspace_id and started_at >= now() - interval '7 days'
  ),
  ai as (
    select status, created_at
    from public.ai_usage_events
    where workspace_id = p_workspace_id and created_at >= now() - interval '7 days'
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'leads', (select count(*) from l),
      'qualified', (select count(*) from l where qualification_status = 'completed' and priority in ('high', 'medium')),
      'highPriority', (select count(*) from l where priority = 'high'),
      'needsReview', (select count(*) from l where qualification_status in ('needs_review', 'failed'))
    ),
    'conversion', (
      select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', coalesce(c.n, 0)) order by s.ord), '[]'::jsonb)
      from statuses s
      left join (select status, count(*) as n from l group by status) c on c.status = s.status
    ),
    'winRate', (
      select case when count(*) filter (where status in ('won', 'lost')) = 0 then null
        else round(count(*) filter (where status = 'won')::numeric / count(*) filter (where status in ('won', 'lost')), 4)
      end
      from l
    ),
    'aiActivity', jsonb_build_object(
      'last7Days', (select count(*) from ai where status not in ('pending', 'rejected_quota', 'rejected_disabled')),
      'succeeded', (select count(*) from ai where status = 'success'),
      'failed', (select count(*) from ai where status in ('invalid_response', 'error', 'timeout')),
      'todayUsed', (
        select count(*) from ai
        where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
          and status not in ('rejected_quota', 'rejected_disabled')
      )
    ),
    'workflowStatus', jsonb_build_object(
      'succeeded', (select count(*) from ex where status = 'succeeded'),
      'partial', (select count(*) from ex where status = 'partial'),
      'failed', (select count(*) from ex where status = 'failed'),
      'running', (select count(*) from ex where status = 'running')
    ),
    'sampleRecordCount', (select count(*) from l where is_sample)
  );
$$;

create or replace function public.lead_analytics(p_workspace_id uuid, p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone 'utc') - make_interval(days => greatest(1, least(p_days, 365)) - 1))::date as start_day,
           (now() at time zone 'utc')::date as end_day
  ),
  days as (
    select generate_series(b.start_day, b.end_day, interval '1 day')::date as day from bounds b
  ),
  l as (
    select ld.*
    from public.leads ld, bounds b
    where ld.workspace_id = p_workspace_id and (ld.created_at at time zone 'utc')::date >= b.start_day
  ),
  ex as (
    select e.status, (e.started_at at time zone 'utc')::date as day
    from public.workflow_executions e, bounds b
    where e.workspace_id = p_workspace_id and (e.started_at at time zone 'utc')::date >= b.start_day
  ),
  buckets(bucket, lo, hi, ord) as (
    values ('0-19', 0, 19, 1), ('20-39', 20, 39, 2), ('40-59', 40, 59, 3), ('60-79', 60, 79, 4), ('80-100', 80, 100, 5)
  )
  select jsonb_build_object(
    'days', greatest(1, least(p_days, 365)),
    'leadVolume', (
      select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'count', coalesce(c.n, 0)) order by d.day), '[]'::jsonb)
      from days d
      left join (select (created_at at time zone 'utc')::date as day, count(*) as n from l group by 1) c on c.day = d.day
    ),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'count', n) order by n desc, source), '[]'::jsonb)
      from (select source, count(*) as n from l group by source) s
    ),
    'scoreDistribution', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket, 'count', coalesce(c.n, 0)) order by b.ord), '[]'::jsonb)
      from buckets b
      left join lateral (select count(*) as n from l where l.score between b.lo and b.hi) c on true
    ),
    'qualificationResults', (
      select coalesce(jsonb_agg(jsonb_build_object('status', qualification_status, 'count', n) order by n desc), '[]'::jsonb)
      from (select qualification_status, count(*) as n from l group by qualification_status) q
    ),
    'priorities', (
      select coalesce(jsonb_agg(jsonb_build_object('priority', p, 'count', n) order by ord), '[]'::jsonb)
      from (
        select coalesce(priority, 'unscored') as p,
               case coalesce(priority, 'unscored') when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end as ord,
               count(*) as n
        from l group by 1, 2
      ) p
    ),
    'workflowOutcomes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'succeeded', coalesce(c.ok, 0), 'partial', coalesce(c.part, 0), 'failed', coalesce(c.bad, 0)
      ) order by d.day), '[]'::jsonb)
      from days d
      left join (
        select day,
               count(*) filter (where status = 'succeeded') as ok,
               count(*) filter (where status = 'partial') as part,
               count(*) filter (where status = 'failed') as bad
        from ex group by day
      ) c on c.day = d.day
    ),
    'sampleRecordCount', (select count(*) from l where is_sample)
  );
$$;

create or replace function public.workflow_overview(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(o)::jsonb order by o."workflowKey", o.engine), '[]'::jsonb)
  from (
    select
      e.workflow_key as "workflowKey",
      e.engine,
      count(*) as total,
      count(*) filter (where e.status = 'succeeded') as succeeded,
      count(*) filter (where e.status = 'partial') as partial,
      count(*) filter (where e.status = 'failed') as failed,
      count(*) filter (where e.status = 'running') as running,
      round(avg(e.duration_ms))::integer as "avgDurationMs",
      max(e.started_at) as "lastRunAt",
      (array_agg(e.status order by e.started_at desc))[1] as "lastStatus"
    from public.workflow_executions e
    where e.workspace_id = p_workspace_id
    group by e.workflow_key, e.engine
  ) o;
$$;

revoke all on function public.dashboard_summary(uuid) from public, anon;
revoke all on function public.lead_analytics(uuid, integer) from public, anon;
revoke all on function public.workflow_overview(uuid) from public, anon;
grant execute on function public.dashboard_summary(uuid) to authenticated, service_role;
grant execute on function public.lead_analytics(uuid, integer) to authenticated, service_role;
grant execute on function public.workflow_overview(uuid) to authenticated, service_role;

-- ===== supabase/seed.sql =====
-- GENERATED by scripts/generate-seed.ts from packages/shared/src/sample-data.ts. Do not edit by hand.
-- Synthetic portfolio-preview data: fictional people and companies, reserved email domains, 555-01xx phones.
-- Every row is is_sample = true. Qualification fixtures use model 'sample-data' (not AI output).
--
-- Safe to run repeatedly: it upserts the single demo workspace (fixed id) and replaces only that workspace's
-- rows. It fails instead of touching anything if another workspace already uses the demo slug or is_demo flag.
begin;
set local standard_conforming_strings = on;

insert into public.workspaces (id, name, slug, is_demo)
values ('0d3e0000-0000-4000-8000-000000000001', 'LeadPilot Demo (sample data)', 'leadpilot-demo', true)
on conflict (id) do update set name = excluded.name, slug = excluded.slug, is_demo = true;

-- The demo workspace never has members and only holds generated rows.
delete from public.notification_events where workspace_id = '0d3e0000-0000-4000-8000-000000000001';
delete from public.ai_usage_events where workspace_id = '0d3e0000-0000-4000-8000-000000000001';
delete from public.workflow_executions where workspace_id = '0d3e0000-0000-4000-8000-000000000001';
delete from public.leads where workspace_id = '0d3e0000-0000-4000-8000-000000000001';
delete from public.integration_settings where workspace_id = '0d3e0000-0000-4000-8000-000000000001';
delete from public.integration_secrets where workspace_id = '0d3e0000-0000-4000-8000-000000000001';
delete from public.workspace_members where workspace_id = '0d3e0000-0000-4000-8000-000000000001';

insert into public.leads (id, workspace_id, name, email, phone, company, job_title, website, source, message, status, score, priority, category, ai_summary, ai_reasoning, recommended_action, confidence, qualification_status, qualification_error, last_qualified_at, owner_id, is_sample, submission_count, created_by, created_at, updated_at) values
  ('0d3e0000-0000-4000-8000-000000001000', '0d3e0000-0000-4000-8000-000000000001', 'Ada Sampleton', 'ada.sampleton@quillfeather.example', '+1 555-0101', 'Quillfeather Analytics (Sample)', 'CTO', 'https://quillfeather.example', 'website_form', 'We need a multi-tenant SaaS dashboard so our customers can explore their own analytics. React front end, Postgres, SSO for enterprise accounts. Budget is around $60k and we want a first release by the end of Q1.', 'won', 92, 'high', 'software_development', 'CTO requesting a multi-tenant analytics SaaS with SSO; ~$60k budget, Q1 launch.', 'Explicit build request that matches custom software development. Budget and deadline are stated, the sender is a CTO on a company domain, and the scope is described in enough detail to scope.', 'Book a discovery call within 24 hours and prepare a phased SaaS proposal.', 0.93, 'completed', null, (now() - interval '986:59:54.778'), null, true, 1, null, (now() - interval '987:00:00.000'), (now() - interval '647:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000100b', '0d3e0000-0000-4000-8000-000000000001', 'Ben Mockridge', 'ben.mockridge@tidewater-freight.example', '+1 555-0102', 'Tidewater Freight Co. (Sample)', 'Operations Director', 'https://tidewater-freight.example', 'landing_page', 'Looking to automate our inbound order emails: classify ~400 emails a day with AI and push structured orders into our ERP. Budget $25-35k, we would like a pilot running within 6 weeks.', 'proposal', 89, 'high', 'ai_automation', 'Operations director wants AI email-to-ERP order automation; $25-35k, 6-week pilot.', 'Clear automation project in the AI automation service line with a budget range and timeline. Director-level contact on a company domain. Volume figures make the scope concrete.', 'Send the AI automation case study and propose a paid 2-week pilot scope.', 0.9, 'completed', null, (now() - interval '292:59:53.350'), null, true, 1, null, (now() - interval '293:00:00.000'), (now() - interval '223:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001014', '0d3e0000-0000-4000-8000-000000000001', 'Carla Lorem', 'carla@copperkettle.example', '+1 555-0103', 'Copperkettle Coffee Roasters (Sample)', 'Marketing Manager', 'https://copperkettle.example', 'website_form', 'Our website is six years old and painfully slow on mobile. We want a redesign with online ordering for beans and subscriptions. Budget is roughly $12k, no hard deadline.', 'contacted', 73, 'high', 'web_design', 'Coffee roaster wants a mobile-friendly redesign with online ordering; ~$12k.', 'Direct redesign request that fits web design services. Budget stated but no timeline. Marketing manager may need sign-off from the owner.', 'Reply with two redesign references and ask who approves the budget.', 0.84, 'completed', null, (now() - interval '198:59:54.071'), null, true, 1, null, (now() - interval '199:00:00.000'), (now() - interval '179:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000101c', '0d3e0000-0000-4000-8000-000000000001', 'Dev Placeholder', 'dev@lumenlark.example', '+1 555-0104', 'Lumen & Lark Bakery (Sample)', 'Founder', null, 'referral', 'A friend recommended you. We are thinking about a simple loyalty app for iOS and Android (stamp card, push offers). Have not worked out a budget yet.', 'lost', 62, 'medium', 'mobile_app', 'Bakery founder exploring a loyalty mobile app; no budget yet.', 'Real interest in a mobile app that matches services, decision maker is the founder, but there is no budget or timeline and the feature set is still vague.', 'Offer a short scoping call and share typical cost ranges for loyalty apps.', 0.78, 'completed', null, (now() - interval '481:29:58.654'), null, true, 1, null, (now() - interval '482:00:00.000'), (now() - interval '331:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001024', '0d3e0000-0000-4000-8000-000000000001', 'Elena Ipsum', 'elena.ipsum@harborlight.example', '+1 555-0105', 'Harborlight Dental Group (Sample)', 'Head of Data', 'https://harborlight.example', 'linkedin', 'We run 14 clinics and need a reporting pipeline that consolidates appointment and billing data into dashboards for the leadership team. Budget is approved for this fiscal year; we are aiming for three months.', 'qualified', 86, 'high', 'data_analytics', 'Dental group (14 clinics) needs a consolidated reporting pipeline; budget approved, 3 months.', 'Data analytics project with approved budget and a timeline. Head of Data has authority and the request is specific about sources and audience.', 'Schedule a technical discovery session with their data team this week.', 0.88, 'completed', null, (now() - interval '122:59:57.689'), null, true, 1, null, (now() - interval '124:00:00.000'), (now() - interval '96:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000102d', '0d3e0000-0000-4000-8000-000000000001', 'Farah Dolor', 'farah.dolor@example.net', null, 'Independent (Sample)', 'Frontend Developer', 'https://portfolio.farah-dolor.example', 'website_form', 'Hi! I''m a frontend developer with four years of React experience. I''d love to be considered for any openings on your team. My portfolio is linked above.', 'disqualified', 18, 'low', 'job_application', 'Job application from a frontend developer, not a sales inquiry.', 'The message is a job application rather than a request for services, so buying intent and fit are minimal.', 'Forward to hiring and mark as not a sales lead.', 0.95, 'completed', null, (now() - interval '728:59:53.832'), null, true, 1, null, (now() - interval '729:00:00.000'), (now() - interval '723:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001033', '0d3e0000-0000-4000-8000-000000000001', 'Gus Dummyfield', 'offers@toprank-growth.example', null, 'TopRank Growth Agency (Sample)', null, 'https://toprank-growth.example', 'website_form', 'Dear website owner, we GUARANTEE first-page search rankings in 30 days for only $99/month. Limited offer, reply YES to get started!!!', 'new', 6, 'low', 'spam', 'Unsolicited SEO sales pitch.', 'Mass-marketing SEO offer with no request for services. Classified as spam, which always routes to review.', 'Confirm as spam and disqualify.', 0.97, 'needs_review', null, (now() - interval '82:59:55.418'), null, true, 1, null, (now() - interval '83:00:00.000'), (now() - interval '82:59:55.418')),
  ('0d3e0000-0000-4000-8000-000000001038', '0d3e0000-0000-4000-8000-000000000001', 'Hal Fixture', 'hal@blockyield.example', null, 'BlockYield Partners (Sample)', 'Partnerships', null, 'email', 'Partnership opportunity: integrate our token rewards into your clients’ apps for a 40% revenue share. Need your answer today to lock in founding-partner terms.', 'new', 13, 'low', 'spam', 'High-pressure token rewards partnership pitch.', 'Unsolicited offer with urgency pressure and no service request. Looks like spam but mentions a partnership, so a human should confirm.', 'Review and disqualify unless the sender is known.', 0.72, 'needs_review', null, (now() - interval '363:59:57.185'), null, true, 1, null, (now() - interval '366:00:00.000'), (now() - interval '363:59:57.185')),
  ('0d3e0000-0000-4000-8000-00000000103d', '0d3e0000-0000-4000-8000-000000000001', 'Ivy Stubworth', 'office@pinecrest-vet.example', '+1 555-0109', 'Pinecrest Veterinary Clinic (Sample)', 'Office Manager', 'https://pinecrest-vet.example', 'n8n', 'The appointment booking form you built for us last year stopped sending confirmation emails on Monday. Clients are calling to double-check bookings. Can someone take a look?', 'contacted', 44, 'medium', 'support_request', 'Existing client reports booking confirmation emails failing since Monday.', 'Support issue from an existing client rather than new work. Clear description and contact details; small potential for a maintenance retainer.', 'Open a support ticket and reply with an ETA today.', 0.81, 'completed', null, (now() - interval '55:59:54.807'), null, true, 1, null, (now() - interval '56:00:00.000'), (now() - interval '54:30:00.000')),
  ('0d3e0000-0000-4000-8000-000000001043', '0d3e0000-0000-4000-8000-000000000001', 'Jonah Fakewell', 'jonah.fakewell@cobaltwave.example', '+1 555-0110', 'Cobaltwave Robotics (Sample)', 'VP Engineering', 'https://cobaltwave.example', 'event', 'Following up from the meetup: we need help building an internal tool to track robot fleet telemetry. Could you add two senior engineers to our team for four months? Roughly $20k per month.', 'proposal', 91, 'high', 'software_development', 'VP Engineering wants 2 senior engineers for 4 months on a telemetry tool; ~$20k/month.', 'Concrete staffing request for software development with budget and duration. VP-level authority and an in-person introduction.', 'Propose a team and start date; send rate card today.', 0.91, 'completed', null, (now() - interval '647:59:58.233'), null, true, 1, null, (now() - interval '649:00:00.000'), (now() - interval '529:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000104d', '0d3e0000-0000-4000-8000-000000000001', 'Kira Testova', 'kira.testova@saltmarsh-realty.example', '+1 555-0111', 'Saltmarsh Realty (Sample)', 'Product Owner', 'https://saltmarsh-realty.example', 'website_form', 'We want to add AI-written property descriptions to our listing admin, and maybe a chat assistant for buyers later. Still exploring options; the timeline is flexible.', 'qualified', 64, 'medium', 'ai_automation', 'Realty firm exploring AI-generated listing descriptions; flexible timeline.', 'Good fit for AI automation, but the request is exploratory with no budget and a flexible timeline.', 'Send a short AI content generation demo and ask about budget range.', 0.74, 'completed', null, (now() - interval '249:59:54.517'), null, true, 1, null, (now() - interval '250:00:00.000'), (now() - interval '175:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001054', '0d3e0000-0000-4000-8000-000000000001', 'Leo Demoray', 'leo.demoray@example.org', null, 'Lakeshore University (Sample)', 'Student', null, 'website_form', 'Hello, I am writing a university project on CRM automation. Could I interview someone from your team for about 20 minutes?', 'disqualified', 17, 'low', 'other', 'Student requesting an interview for a university project.', 'No purchase intent; an informational request from a student.', 'Reply politely if time allows; not a sales opportunity.', 0.86, 'completed', null, (now() - interval '556:59:54.594'), null, true, 1, null, (now() - interval '557:00:00.000'), (now() - interval '531:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000105a', '0d3e0000-0000-4000-8000-000000000001', 'Mina Sampleworth', 'mina@ironbark-fitness.example', '+1 555-0113', 'Ironbark Fitness Studios (Sample)', 'CEO', 'https://ironbark-fitness.example', 'phone', 'Phone inquiry: wants a member portal with class booking and payments for three studio locations. Budget about $40k, would like to start next month.', 'won', 91, 'high', 'software_development', 'Fitness chain CEO wants a member portal with booking and payments; ~$40k, start next month.', 'Decision maker with a defined build, budget and start date. Phone notes are brief, so some details still need confirming.', 'Send a proposal with a 3-phase plan this week.', 0.9, 'completed', null, (now() - interval '917:41:57.452'), null, true, 1, null, (now() - interval '918:00:00.000'), (now() - interval '658:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001064', '0d3e0000-0000-4000-8000-000000000001', 'Nico Mockwell', 'nico.mockwell@fernhollow.example', '+1 555-0114', 'Fernhollow Community College (Sample)', 'IT Coordinator', 'https://fernhollow.example', 'website_form', 'Requesting a quote to migrate our course catalog website to a modern CMS. Procurement requires three quotes by the end of the month.', 'lost', 77, 'high', 'web_design', 'College requests a quote for a CMS migration of its course catalog; quotes due end of month.', 'Formal quote request that fits web services, with a procurement deadline. Competitive bid lowers the odds somewhat.', 'Submit a quote before the procurement deadline.', 0.82, 'completed', null, (now() - interval '841:59:54.207'), null, true, 1, null, (now() - interval '842:00:00.000'), (now() - interval '441:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000106f', '0d3e0000-0000-4000-8000-000000000001', 'Opal Fixturewood', 'opal@brightloom.example', '+1 555-0115', 'Brightloom Design Agency (Sample)', 'Partnerships Lead', 'https://brightloom.example', 'email', 'We are a design agency looking for a development partner for overflow work, typically two or three projects per quarter. Interested in a call?', 'contacted', 64, 'medium', 'partnership', 'Design agency seeking a recurring development partner for overflow projects.', 'Recurring partnership could be valuable, but no specific project, budget or timeline yet.', 'Book an intro call and share the partner rate card.', 0.69, 'completed', null, (now() - interval '431:59:58.381'), null, true, 1, null, (now() - interval '435:00:00.000'), (now() - interval '409:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001075', '0d3e0000-0000-4000-8000-000000000001', 'Pax Dummond', 'pax@dummond-consulting.example', '+1 555-0116', 'Dummond Consulting (Sample)', 'Owner', 'https://dummond-consulting.example', 'n8n', 'Could you advise us on whether to build or buy a CRM for our 12-person firm? A two-hour workshop would be ideal.', 'new', 61, 'medium', 'consulting', 'Small firm owner wants a two-hour build-vs-buy CRM workshop.', 'Clear request for a consulting workshop from the owner; small scope and no stated budget.', 'Offer the fixed-price workshop package.', 0.65, 'completed', null, (now() - interval '145:59:54.019'), null, true, 1, null, (now() - interval '146:00:00.000'), (now() - interval '145:59:54.019')),
  ('0d3e0000-0000-4000-8000-00000000107a', '0d3e0000-0000-4000-8000-000000000001', 'Quinn Stubbington', 'quinn@mapleway-tutors.example', '+1 555-0117', 'Mapleway Tutors (Sample)', 'Co-founder', 'https://mapleway-tutors.example', 'landing_page', 'We need an MVP that matches tutors with students, mobile first. Investor meeting in 8 weeks, budget about $30k.', 'qualified', 86, 'high', 'mobile_app', 'Startup co-founder needs a tutor-matching mobile MVP in 8 weeks; ~$30k.', 'Well-defined MVP with budget and investor deadline. Co-founder has authority. Mobile-first fits the mobile app service.', 'Propose an 8-week MVP plan with a weekly demo cadence.', 0.87, 'completed', null, (now() - interval '342:23:58.083'), null, true, 1, null, (now() - interval '343:00:00.000'), (now() - interval '295:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001085', '0d3e0000-0000-4000-8000-000000000001', 'Rosa Examplar', 'rosa@glimmerfield-events.example', null, 'Glimmerfield Events (Sample)', null, null, 'website_form', 'Hi, saw your site. What do you do exactly? Interested in maybe automating some stuff.', 'new', 27, 'low', 'ai_automation', 'Vague interest in automation from an events company.', 'Possible automation interest but almost no detail, no role and no budget. Low confidence in the category.', 'Reply asking which processes they want to automate.', 0.48, 'needs_review', null, (now() - interval '104:59:55.066'), null, true, 1, null, (now() - interval '105:00:00.000'), (now() - interval '104:59:55.066')),
  ('0d3e0000-0000-4000-8000-00000000108a', '0d3e0000-0000-4000-8000-000000000001', 'Sami Testwood', 'sami@driftwood-kayak.example', '+1 555-0119', 'Driftwood Kayak Rentals (Sample)', 'Owner', null, 'website_form', 'Need a booking website before the summer season. Budget is small, maybe $3k. Can you do something like that?', 'new', 64, 'medium', 'web_design', 'Kayak rental owner wants a booking website before summer; ~$3k budget.', 'Fits web design but the budget may be below the minimum engagement. Could also be a template-site job, so confidence is limited.', 'Check minimum engagement size before replying.', 0.58, 'needs_review', null, (now() - interval '216:59:54.990'), null, true, 1, null, (now() - interval '217:00:00.000'), (now() - interval '216:59:54.990')),
  ('0d3e0000-0000-4000-8000-00000000108f', '0d3e0000-0000-4000-8000-000000000001', 'Theo Ipsumson', 'theo@starfold-payments.example', '+1 555-0120', 'Starfold Payments (Sample)', 'CTO', 'https://starfold-payments.example', 'api', 'We need help hardening our checkout API and adding webhook retries. Some of the work touches PCI-scoped systems.', 'new', null, null, null, null, null, null, null, 'failed', 'AI provider unavailable after 2 attempts (HTTP 503). Retry from the lead page.', null, null, true, 1, null, (now() - interval '27:00:00.000'), (now() - interval '24:59:57.460')),
  ('0d3e0000-0000-4000-8000-000000001095', '0d3e0000-0000-4000-8000-000000000001', 'Uma Samplevale', 'uma.samplevale@wrenfield.example', '+1 555-0121', 'Wrenfield Library Trust (Sample)', 'Director', 'https://wrenfield.example', 'website_form', 'We need an accessibility audit of our public website and fixes for the issues found, ideally before our grant review in the spring.', 'contacted', null, null, null, null, null, null, null, 'failed', 'AI response failed schema validation (criteria missing). Qualify manually or retry.', null, null, true, 1, null, (now() - interval '532:00:00.000'), (now() - interval '502:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000109c', '0d3e0000-0000-4000-8000-000000000001', 'Vic Stubhaus', 'vic@orchardlane-grocers.example', '+1 555-0122', 'Orchard Lane Grocers (Sample)', 'Operations Manager', 'https://orchardlane-grocers.example', 'n8n', 'We want low-stock alerts from our inventory system posted to our team chat, plus a weekly reorder summary.', 'new', null, null, null, null, null, null, null, 'failed', 'AI request timed out in the n8n workflow. Retry from the lead page.', null, null, true, 1, null, (now() - interval '272:00:00.000'), (now() - interval '271:59:52.690')),
  ('0d3e0000-0000-4000-8000-0000000010a0', '0d3e0000-0000-4000-8000-000000000001', 'Wes Demoberg', 'wes.demoberg@pebblecrest.example', '+1 555-0123', 'Pebblecrest Insurance (Sample)', 'Head of Growth', 'https://pebblecrest.example', 'website_form', 'We would like a lead scoring model built on our CRM history and wired into our sales team’s daily workflow.', 'new', null, null, null, null, null, null, null, 'pending', null, null, null, true, 1, null, (now() - interval '5:00:00.000'), (now() - interval '4:59:56.312')),
  ('0d3e0000-0000-4000-8000-0000000010a3', '0d3e0000-0000-4000-8000-000000000001', 'Xena Mockford', 'xena@sundial-skincare.example', '+1 555-0124', 'Sundial Skincare (Sample)', 'Founder', 'https://sundial-skincare.example', 'manual', 'Entered after a call: wants a storefront redesign and a subscription box flow. Will send brand guidelines.', 'new', null, null, null, null, null, null, null, 'pending', null, null, null, true, 1, null, (now() - interval '2:00:00.000'), (now() - interval '2:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010a5', '0d3e0000-0000-4000-8000-000000000001', 'Yara Fixture', 'yara.fixture@kestrel-storage.example', null, 'Kestrel Self Storage (Sample)', 'Facilities Coordinator', null, 'website_form', 'Please remove us from your mailing list. Thank you.', 'disqualified', null, null, null, null, null, null, null, 'skipped', null, null, null, true, 1, null, (now() - interval '798:00:00.000'), (now() - interval '795:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010a9', '0d3e0000-0000-4000-8000-000000000001', 'Zane Exampleton', 'zane@hearthstone-plumbing.example', '+1 555-0126', 'Hearthstone Plumbing (Sample)', 'Owner', 'https://hearthstone-plumbing.example', 'manual', 'Imported from the previous CRM: existing website maintenance client since last year.', 'won', null, null, null, null, null, null, null, 'skipped', null, null, null, true, 1, null, (now() - interval '1061:00:00.000'), (now() - interval '1060:48:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010ac', '0d3e0000-0000-4000-8000-000000000001', 'Bea Quillon', 'bea.quillon@oakhaven-legal.example', '+1 555-0127', 'Oakhaven Legal LLP (Sample)', 'Managing Partner', 'https://oakhaven-legal.example', 'referral', 'Referred by Pinecrest Veterinary. We need a secure client intake portal with document upload and e-signature.', 'proposal', 82, 'high', 'software_development', 'Law firm client portal; budget and deadline confirmed on call.', null, 'Send the proposal by Friday.', null, 'completed', null, (now() - interval '361:00:00.000'), null, true, 1, null, (now() - interval '387:00:00.000'), (now() - interval '287:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010b5', '0d3e0000-0000-4000-8000-000000000001', 'Cal Dummington', 'cal@hollowbrook-games.example', '+1 555-0128', 'Hollowbrook Games (Sample)', 'Product Manager', 'https://hollowbrook-games.example', 'website_form', 'We need a companion web app for our indie game with leaderboards and player profiles. Budget around $15k, launch alongside our next update in two months.', 'contacted', 76, 'high', 'software_development', 'Game studio wants a companion web app with leaderboards; ~$15k, 2-month timeline.', 'Specific build request with budget and launch date. Product manager may need studio approval.', 'Reply with a similar case study and propose a call.', 0.83, 'completed', null, (now() - interval '605:59:53.096'), null, true, 2, null, (now() - interval '606:00:00.000'), (now() - interval '486:00:00.000'));

insert into public.workflow_executions (id, workspace_id, lead_id, workflow_key, engine, trigger, status, steps, attempt, retry_of_id, error_code, error_message, started_at, finished_at, duration_ms, created_by, is_sample) values
  ('0d3e0000-0000-4000-8000-000000001002', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '986:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":8}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '986:59:56.392') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":21}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '986:59:56.371') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1219,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '986:59:55.152') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":89}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '986:59:55.063') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":262,"attempts":1}'::jsonb), 1, null, null, null, (now() - interval '986:59:56.400'), (now() - interval '986:59:54.778'), 1622, null, true),
  ('0d3e0000-0000-4000-8000-00000000100d', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '292:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":4}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '292:59:56.396') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":44}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '292:59:56.352') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":2391,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '292:59:53.961') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":95}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '292:59:53.866') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":502,"attempts":1}'::jsonb), 1, null, null, null, (now() - interval '292:59:56.400'), (now() - interval '292:59:53.350'), 3050, null, true),
  ('0d3e0000-0000-4000-8000-000000001016', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001014', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '198:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":12}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '198:59:56.388') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":35}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '198:59:56.353') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1796,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '198:59:54.557') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":64}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '198:59:54.493') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":407,"attempts":1}'::jsonb), 1, null, null, null, (now() - interval '198:59:56.400'), (now() - interval '198:59:54.071'), 2329, null, true),
  ('0d3e0000-0000-4000-8000-00000000101e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000101c', 'lead_qualification', 'worker', 'manual', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '481:30:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1286,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '481:29:58.714') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":49}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '481:29:58.665') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '481:30:00.000'), (now() - interval '481:29:58.654'), 1346, null, true),
  ('0d3e0000-0000-4000-8000-000000001026', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', 'lead_qualification', 'worker', 'manual', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '123:00:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1651,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '122:59:58.349') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":68}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '122:59:58.281') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":567,"attempts":1}'::jsonb), 1, null, null, null, (now() - interval '123:00:00.000'), (now() - interval '122:59:57.689'), 2311, null, true),
  ('0d3e0000-0000-4000-8000-00000000102f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000102d', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '728:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":10}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '728:59:56.390') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":38}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '728:59:56.352') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":2415,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '728:59:53.937') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":85}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '728:59:53.852') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '728:59:56.400'), (now() - interval '728:59:53.832'), 2568, null, true),
  ('0d3e0000-0000-4000-8000-000000001035', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001033', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '82:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":3}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '82:59:56.397') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":23}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '82:59:56.374') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":900,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '82:59:55.474') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":43}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '82:59:55.431') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '82:59:56.400'), (now() - interval '82:59:55.418'), 982, null, true),
  ('0d3e0000-0000-4000-8000-00000000103a', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001038', 'lead_qualification', 'worker', 'manual', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '364:00:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":2726,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '363:59:57.274') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":74}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '363:59:57.200') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '364:00:00.000'), (now() - interval '363:59:57.185'), 2815, null, true),
  ('0d3e0000-0000-4000-8000-00000000103f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000103d', 'lead_intake', 'n8n', 'n8n_webhook', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '55:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":8}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '55:59:56.392') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":52}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '55:59:56.340') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1450,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '55:59:54.890') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":62}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '55:59:54.828') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '55:59:56.400'), (now() - interval '55:59:54.807'), 1593, null, true),
  ('0d3e0000-0000-4000-8000-000000001045', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'lead_qualification', 'worker', 'manual', 'partial', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '648:00:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1447,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '647:59:58.553') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":81}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '647:59:58.472') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"failed","durationMs":221,"attempts":1,"message":"Slack webhook returned HTTP 404: no_service"}'::jsonb), 1, null, 'integration_failed', 'Slack notification failed: Slack webhook returned HTTP 404: no_service', (now() - interval '648:00:00.000'), (now() - interval '647:59:58.233'), 1767, null, true),
  ('0d3e0000-0000-4000-8000-00000000104f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000104d', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '249:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":7}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '249:59:56.393') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":25}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '249:59:56.368') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1790,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '249:59:54.578') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":50}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '249:59:54.528') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '249:59:56.400'), (now() - interval '249:59:54.517'), 1883, null, true),
  ('0d3e0000-0000-4000-8000-000000001056', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001054', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '556:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":12}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '556:59:56.388') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":26}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '556:59:56.362') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1715,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '556:59:54.647') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":36}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '556:59:54.611') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '556:59:56.400'), (now() - interval '556:59:54.594'), 1806, null, true),
  ('0d3e0000-0000-4000-8000-00000000105c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'lead_qualification', 'worker', 'manual', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '917:42:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":2175,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '917:41:57.825') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":65}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '917:41:57.760') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":301,"attempts":1}'::jsonb), 1, null, null, null, (now() - interval '917:42:00.000'), (now() - interval '917:41:57.452'), 2548, null, true),
  ('0d3e0000-0000-4000-8000-000000001066', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '841:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":8}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '841:59:56.392') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":36}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '841:59:56.356') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1686,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '841:59:54.670') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":73}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '841:59:54.597') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":384,"attempts":1}'::jsonb), 1, null, null, null, (now() - interval '841:59:56.400'), (now() - interval '841:59:54.207'), 2193, null, true),
  ('0d3e0000-0000-4000-8000-000000001071', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000106f', 'lead_qualification', 'worker', 'manual', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '432:00:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1559,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '431:59:58.441') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":37}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '431:59:58.404') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '432:00:00.000'), (now() - interval '431:59:58.381'), 1619, null, true),
  ('0d3e0000-0000-4000-8000-000000001077', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001075', 'lead_intake', 'n8n', 'n8n_webhook', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '145:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":7}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '145:59:56.393') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":52}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '145:59:56.341') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":2269,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '145:59:54.072') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":35}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '145:59:54.037') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '145:59:56.400'), (now() - interval '145:59:54.019'), 2381, null, true),
  ('0d3e0000-0000-4000-8000-00000000107c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'lead_intake', 'worker', 'web_form', 'partial', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '342:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":4}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '342:59:56.396') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":35}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '342:59:56.361') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"failed","durationMs":3070,"attempts":2,"message":"AI provider returned HTTP 503 after 2 attempts"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '342:59:53.291') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":51}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '342:59:53.240') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 1, null, 'ai_unavailable', 'AI provider returned HTTP 503 after 2 attempts', (now() - interval '342:59:56.400'), (now() - interval '342:59:53.224'), 3176, null, true),
  ('0d3e0000-0000-4000-8000-00000000107e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'lead_qualification', 'worker', 'retry', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '342:24:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1283,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '342:23:58.717') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":95}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '342:23:58.622') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":525,"attempts":1}'::jsonb), 2, '0d3e0000-0000-4000-8000-00000000107c', null, null, (now() - interval '342:24:00.000'), (now() - interval '342:23:58.083'), 1917, null, true),
  ('0d3e0000-0000-4000-8000-000000001087', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001085', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '104:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":11}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '104:59:56.389') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":25}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '104:59:56.364') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1245,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '104:59:55.119') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":47}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '104:59:55.072') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '104:59:56.400'), (now() - interval '104:59:55.066'), 1334, null, true),
  ('0d3e0000-0000-4000-8000-00000000108c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108a', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '216:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":3}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '216:59:56.397') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":58}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '216:59:56.339') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":1275,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '216:59:55.064') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":58}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '216:59:55.006') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '216:59:56.400'), (now() - interval '216:59:54.990'), 1410, null, true),
  ('0d3e0000-0000-4000-8000-000000001091', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108f', 'lead_intake', 'worker', 'api', 'partial', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '26:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":8}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '26:59:56.392') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":32}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '26:59:56.360') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"failed","durationMs":5514,"attempts":2,"message":"AI provider returned HTTP 503 after 2 attempts"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '26:59:50.846') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":38}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '26:59:50.808') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 1, null, 'ai_unavailable', 'AI provider returned HTTP 503 after 2 attempts', (now() - interval '26:59:56.400'), (now() - interval '26:59:50.790'), 5610, null, true),
  ('0d3e0000-0000-4000-8000-000000001093', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108f', 'lead_qualification', 'worker', 'retry', 'failed', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '25:00:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"failed","durationMs":2520,"attempts":2,"message":"AI provider returned HTTP 503 after 2 attempts"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '24:59:57.480') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 2, '0d3e0000-0000-4000-8000-000000001091', 'ai_unavailable', 'AI provider returned HTTP 503 after 2 attempts', (now() - interval '25:00:00.000'), (now() - interval '24:59:57.460'), 2540, null, true),
  ('0d3e0000-0000-4000-8000-000000001097', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001095', 'lead_intake', 'worker', 'web_form', 'partial', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '531:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":6}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '531:59:56.394') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":53}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '531:59:56.341') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"failed","durationMs":1922,"attempts":1,"message":"AI response failed schema validation: \"criteria\" is required"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '531:59:54.419') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":57}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '531:59:54.362') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 1, null, 'ai_invalid_response', 'AI response failed schema validation: "criteria" is required', (now() - interval '531:59:56.400'), (now() - interval '531:59:54.354'), 2046, null, true),
  ('0d3e0000-0000-4000-8000-000000001099', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001095', 'lead_qualification', 'worker', 'retry', 'failed', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '512:00:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"failed","durationMs":2671,"attempts":1,"message":"AI response failed schema validation: \"criteria\" is required"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '511:59:57.329') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 2, '0d3e0000-0000-4000-8000-000000001097', 'ai_invalid_response', 'AI response failed schema validation: "criteria" is required', (now() - interval '512:00:00.000'), (now() - interval '511:59:57.303'), 2697, null, true),
  ('0d3e0000-0000-4000-8000-00000000109e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000109c', 'lead_intake', 'n8n', 'n8n_webhook', 'partial', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '271:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":12}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '271:59:56.388') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":57}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '271:59:56.331') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"failed","durationMs":3530,"attempts":2,"message":"AI request timed out after 20s"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '271:59:52.801') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":91}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '271:59:52.710') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 1, null, 'ai_unavailable', 'AI request timed out after 20s', (now() - interval '271:59:56.400'), (now() - interval '271:59:52.690'), 3710, null, true),
  ('0d3e0000-0000-4000-8000-0000000010a2', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a0', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '4:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":6}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '4:59:56.394') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":23}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '4:59:56.371') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"skipped","durationMs":0,"message":"Workspace daily AI limit reached; lead left pending"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '4:59:56.371') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":40}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '4:59:56.331') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 1, null, null, null, (now() - interval '4:59:56.400'), (now() - interval '4:59:56.312'), 88, null, true),
  ('0d3e0000-0000-4000-8000-0000000010a7', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a5', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '797:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":5}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '797:59:56.395') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":51}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '797:59:56.344') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"skipped","durationMs":0,"message":"AI qualification disabled for this workspace"}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '797:59:56.344') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":91}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '797:59:56.253') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"No qualification result"}'::jsonb), 1, null, null, null, (now() - interval '797:59:56.400'), (now() - interval '797:59:56.229'), 171, null, true),
  ('0d3e0000-0000-4000-8000-0000000010ae', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'lead_qualification', 'worker', 'manual', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '386:36:00.000') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":2477,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '386:35:57.523') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":65}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '386:35:57.458') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"skipped","durationMs":0,"message":"Priority below the Slack alert threshold (high)"}'::jsonb), 1, null, null, null, (now() - interval '386:36:00.000'), (now() - interval '386:35:57.436'), 2564, null, true),
  ('0d3e0000-0000-4000-8000-0000000010b7', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', 'lead_intake', 'worker', 'web_form', 'succeeded', jsonb_build_array(jsonb_build_object('startedAt', to_char((now() - interval '605:59:56.400') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"validate","status":"succeeded","durationMs":3}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '605:59:56.397') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"deduplicate","status":"succeeded","durationMs":30}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '605:59:56.367') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"ai_classify","status":"succeeded","durationMs":2638,"attempts":1}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '605:59:53.729') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"persist","status":"succeeded","durationMs":71}'::jsonb, jsonb_build_object('startedAt', to_char((now() - interval '605:59:53.658') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || '{"key":"notify_slack","status":"succeeded","durationMs":550,"attempts":1}'::jsonb), 1, null, null, null, (now() - interval '605:59:56.400'), (now() - interval '605:59:53.096'), 3304, null, true);

insert into public.lead_qualifications (id, workspace_id, lead_id, source, score, priority, category, summary, reasoning, recommended_action, confidence, criteria, adjustments, model, prompt_version, override_reason, execution_id, created_by, is_sample, created_at) values
  ('0d3e0000-0000-4000-8000-000000001003', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'ai', 92, 'high', 'software_development', 'CTO requesting a multi-tenant analytics SaaS with SSO; ~$60k budget, Q1 launch.', 'Explicit build request that matches custom software development. Budget and deadline are stated, the sender is a CTO on a company domain, and the scope is described in enough detail to scope.', 'Book a discovery call within 24 hours and prepare a phased SaaS proposal.', 0.93, '[{"key":"intent","score":24},{"key":"fit","score":23},{"key":"budget_timeline","score":18},{"key":"authority","score":14},{"key":"completeness","score":13}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001002', null, true, (now() - interval '986:59:54.778')),
  ('0d3e0000-0000-4000-8000-00000000100e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', 'ai', 89, 'high', 'ai_automation', 'Operations director wants AI email-to-ERP order automation; $25-35k, 6-week pilot.', 'Clear automation project in the AI automation service line with a budget range and timeline. Director-level contact on a company domain. Volume figures make the scope concrete.', 'Send the AI automation case study and propose a paid 2-week pilot scope.', 0.9, '[{"key":"intent","score":23},{"key":"fit","score":24},{"key":"budget_timeline","score":17},{"key":"authority","score":13},{"key":"completeness","score":12}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000100d', null, true, (now() - interval '292:59:53.350')),
  ('0d3e0000-0000-4000-8000-000000001017', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001014', 'ai', 73, 'high', 'web_design', 'Coffee roaster wants a mobile-friendly redesign with online ordering; ~$12k.', 'Direct redesign request that fits web design services. Budget stated but no timeline. Marketing manager may need sign-off from the owner.', 'Reply with two redesign references and ask who approves the budget.', 0.84, '[{"key":"intent","score":20},{"key":"fit","score":22},{"key":"budget_timeline","score":10},{"key":"authority","score":9},{"key":"completeness","score":12}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001016', null, true, (now() - interval '198:59:54.071')),
  ('0d3e0000-0000-4000-8000-00000000101f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000101c', 'ai', 62, 'medium', 'mobile_app', 'Bakery founder exploring a loyalty mobile app; no budget yet.', 'Real interest in a mobile app that matches services, decision maker is the founder, but there is no budget or timeline and the feature set is still vague.', 'Offer a short scoping call and share typical cost ranges for loyalty apps.', 0.78, '[{"key":"intent","score":18},{"key":"fit","score":20},{"key":"budget_timeline","score":5},{"key":"authority","score":10},{"key":"completeness","score":9}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000101e', null, true, (now() - interval '481:29:58.654')),
  ('0d3e0000-0000-4000-8000-000000001027', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', 'ai', 86, 'high', 'data_analytics', 'Dental group (14 clinics) needs a consolidated reporting pipeline; budget approved, 3 months.', 'Data analytics project with approved budget and a timeline. Head of Data has authority and the request is specific about sources and audience.', 'Schedule a technical discovery session with their data team this week.', 0.88, '[{"key":"intent","score":22},{"key":"fit","score":21},{"key":"budget_timeline","score":16},{"key":"authority","score":14},{"key":"completeness","score":13}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001026', null, true, (now() - interval '122:59:57.689')),
  ('0d3e0000-0000-4000-8000-000000001030', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000102d', 'ai', 18, 'low', 'job_application', 'Job application from a frontend developer, not a sales inquiry.', 'The message is a job application rather than a request for services, so buying intent and fit are minimal.', 'Forward to hiring and mark as not a sales lead.', 0.95, '[{"key":"intent","score":3},{"key":"fit","score":2},{"key":"budget_timeline","score":0},{"key":"authority","score":3},{"key":"completeness","score":10}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000102f', null, true, (now() - interval '728:59:53.832')),
  ('0d3e0000-0000-4000-8000-000000001036', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001033', 'ai', 6, 'low', 'spam', 'Unsolicited SEO sales pitch.', 'Mass-marketing SEO offer with no request for services. Classified as spam, which always routes to review.', 'Confirm as spam and disqualify.', 0.97, '[{"key":"intent","score":0},{"key":"fit","score":0},{"key":"budget_timeline","score":1},{"key":"authority","score":2},{"key":"completeness","score":3}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001035', null, true, (now() - interval '82:59:55.418')),
  ('0d3e0000-0000-4000-8000-00000000103b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001038', 'ai', 13, 'low', 'spam', 'High-pressure token rewards partnership pitch.', 'Unsolicited offer with urgency pressure and no service request. Looks like spam but mentions a partnership, so a human should confirm.', 'Review and disqualify unless the sender is known.', 0.72, '[{"key":"intent","score":2},{"key":"fit","score":3},{"key":"budget_timeline","score":2},{"key":"authority","score":3},{"key":"completeness","score":3}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000103a', null, true, (now() - interval '363:59:57.185')),
  ('0d3e0000-0000-4000-8000-000000001040', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000103d', 'ai', 44, 'medium', 'support_request', 'Existing client reports booking confirmation emails failing since Monday.', 'Support issue from an existing client rather than new work. Clear description and contact details; small potential for a maintenance retainer.', 'Open a support ticket and reply with an ETA today.', 0.81, '[{"key":"intent","score":8},{"key":"fit","score":14},{"key":"budget_timeline","score":2},{"key":"authority","score":8},{"key":"completeness","score":12}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000103f', null, true, (now() - interval '55:59:54.807')),
  ('0d3e0000-0000-4000-8000-000000001046', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'ai', 91, 'high', 'software_development', 'VP Engineering wants 2 senior engineers for 4 months on a telemetry tool; ~$20k/month.', 'Concrete staffing request for software development with budget and duration. VP-level authority and an in-person introduction.', 'Propose a team and start date; send rate card today.', 0.91, '[{"key":"intent","score":23},{"key":"fit","score":22},{"key":"budget_timeline","score":18},{"key":"authority","score":15},{"key":"completeness","score":13}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001045', null, true, (now() - interval '647:59:58.233')),
  ('0d3e0000-0000-4000-8000-000000001050', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000104d', 'ai', 64, 'medium', 'ai_automation', 'Realty firm exploring AI-generated listing descriptions; flexible timeline.', 'Good fit for AI automation, but the request is exploratory with no budget and a flexible timeline.', 'Send a short AI content generation demo and ask about budget range.', 0.74, '[{"key":"intent","score":17},{"key":"fit","score":20},{"key":"budget_timeline","score":6},{"key":"authority","score":11},{"key":"completeness","score":10}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000104f', null, true, (now() - interval '249:59:54.517')),
  ('0d3e0000-0000-4000-8000-000000001057', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001054', 'ai', 17, 'low', 'other', 'Student requesting an interview for a university project.', 'No purchase intent; an informational request from a student.', 'Reply politely if time allows; not a sales opportunity.', 0.86, '[{"key":"intent","score":2},{"key":"fit","score":4},{"key":"budget_timeline","score":0},{"key":"authority","score":2},{"key":"completeness","score":9}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001056', null, true, (now() - interval '556:59:54.594')),
  ('0d3e0000-0000-4000-8000-00000000105d', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'ai', 91, 'high', 'software_development', 'Fitness chain CEO wants a member portal with booking and payments; ~$40k, start next month.', 'Decision maker with a defined build, budget and start date. Phone notes are brief, so some details still need confirming.', 'Send a proposal with a 3-phase plan this week.', 0.9, '[{"key":"intent","score":24},{"key":"fit","score":23},{"key":"budget_timeline","score":18},{"key":"authority","score":15},{"key":"completeness","score":11}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000105c', null, true, (now() - interval '917:41:57.452')),
  ('0d3e0000-0000-4000-8000-000000001067', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'ai', 77, 'high', 'web_design', 'College requests a quote for a CMS migration of its course catalog; quotes due end of month.', 'Formal quote request that fits web services, with a procurement deadline. Competitive bid lowers the odds somewhat.', 'Submit a quote before the procurement deadline.', 0.82, '[{"key":"intent","score":19},{"key":"fit","score":20},{"key":"budget_timeline","score":14},{"key":"authority","score":12},{"key":"completeness","score":12}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001066', null, true, (now() - interval '841:59:54.207')),
  ('0d3e0000-0000-4000-8000-000000001072', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000106f', 'ai', 64, 'medium', 'partnership', 'Design agency seeking a recurring development partner for overflow projects.', 'Recurring partnership could be valuable, but no specific project, budget or timeline yet.', 'Book an intro call and share the partner rate card.', 0.69, '[{"key":"intent","score":15},{"key":"fit","score":18},{"key":"budget_timeline","score":8},{"key":"authority","score":12},{"key":"completeness","score":11}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001071', null, true, (now() - interval '431:59:58.381')),
  ('0d3e0000-0000-4000-8000-000000001078', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001075', 'ai', 61, 'medium', 'consulting', 'Small firm owner wants a two-hour build-vs-buy CRM workshop.', 'Clear request for a consulting workshop from the owner; small scope and no stated budget.', 'Offer the fixed-price workshop package.', 0.65, '[{"key":"intent","score":16},{"key":"fit","score":17},{"key":"budget_timeline","score":9},{"key":"authority","score":9},{"key":"completeness","score":10}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001077', null, true, (now() - interval '145:59:54.019')),
  ('0d3e0000-0000-4000-8000-00000000107f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'ai', 86, 'high', 'mobile_app', 'Startup co-founder needs a tutor-matching mobile MVP in 8 weeks; ~$30k.', 'Well-defined MVP with budget and investor deadline. Co-founder has authority. Mobile-first fits the mobile app service.', 'Propose an 8-week MVP plan with a weekly demo cadence.', 0.87, '[{"key":"intent","score":22},{"key":"fit","score":22},{"key":"budget_timeline","score":17},{"key":"authority","score":13},{"key":"completeness","score":12}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000107e', null, true, (now() - interval '342:23:58.083')),
  ('0d3e0000-0000-4000-8000-000000001088', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001085', 'ai', 27, 'low', 'ai_automation', 'Vague interest in automation from an events company.', 'Possible automation interest but almost no detail, no role and no budget. Low confidence in the category.', 'Reply asking which processes they want to automate.', 0.48, '[{"key":"intent","score":8},{"key":"fit","score":10},{"key":"budget_timeline","score":1},{"key":"authority","score":4},{"key":"completeness","score":4}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-000000001087', null, true, (now() - interval '104:59:55.066')),
  ('0d3e0000-0000-4000-8000-00000000108d', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108a', 'ai', 64, 'medium', 'web_design', 'Kayak rental owner wants a booking website before summer; ~$3k budget.', 'Fits web design but the budget may be below the minimum engagement. Could also be a template-site job, so confidence is limited.', 'Check minimum engagement size before replying.', 0.58, '[{"key":"intent","score":18},{"key":"fit","score":19},{"key":"budget_timeline","score":8},{"key":"authority","score":9},{"key":"completeness","score":10}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-00000000108c', null, true, (now() - interval '216:59:54.990')),
  ('0d3e0000-0000-4000-8000-0000000010af', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'ai', 69, 'medium', 'software_development', 'Law firm partner wants a secure client intake portal with uploads and e-signature.', 'Strong fit and senior contact, but no budget or timeline in the message.', 'Book a discovery call to confirm budget and compliance needs.', 0.76, '[{"key":"intent","score":18},{"key":"fit","score":20},{"key":"budget_timeline","score":9},{"key":"authority","score":12},{"key":"completeness","score":10}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-0000000010ae', null, true, (now() - interval '386:35:57.436')),
  ('0d3e0000-0000-4000-8000-0000000010b1', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'manual', 82, 'high', 'software_development', 'Law firm client portal; budget and deadline confirmed on call.', null, 'Send the proposal by Friday.', null, '[{"key":"intent","score":22},{"key":"fit","score":23},{"key":"budget_timeline","score":17},{"key":"authority","score":12},{"key":"completeness","score":8}]'::jsonb, '[]'::jsonb, null, null, 'Budget (~$45k) and a March deadline were confirmed on the discovery call; referral from an existing client.', null, null, true, (now() - interval '361:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010b8', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', 'ai', 76, 'high', 'software_development', 'Game studio wants a companion web app with leaderboards; ~$15k, 2-month timeline.', 'Specific build request with budget and launch date. Product manager may need studio approval.', 'Reply with a similar case study and propose a call.', 0.83, '[{"key":"intent","score":20},{"key":"fit","score":21},{"key":"budget_timeline","score":12},{"key":"authority","score":11},{"key":"completeness","score":12}]'::jsonb, '[]'::jsonb, 'sample-data', null, null, '0d3e0000-0000-4000-8000-0000000010b7', null, true, (now() - interval '605:59:53.096'));

insert into public.lead_activities (id, workspace_id, lead_id, type, body, metadata, actor_id, is_sample, created_at) values
  ('0d3e0000-0000-4000-8000-000000001001', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '987:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001004', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'qualification_completed', null, '{"score":92,"priority":"high","category":"software_development","executionId":"0d3e0000-0000-4000-8000-000000001002"}'::jsonb, null, true, (now() - interval '986:59:54.778')),
  ('0d3e0000-0000-4000-8000-000000001006', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '986:59:54.778')),
  ('0d3e0000-0000-4000-8000-000000001007', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '984:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001008', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'note_added', 'Discovery call done. They want a fixed-price first phase. (sample note)', '{}'::jsonb, null, true, (now() - interval '957:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001009', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'status_changed', null, '{"from":"contacted","to":"proposal"}'::jsonb, null, true, (now() - interval '891:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000100a', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', 'status_changed', null, '{"from":"proposal","to":"won"}'::jsonb, null, true, (now() - interval '647:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000100c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', 'lead_created', null, '{"source":"landing_page"}'::jsonb, null, true, (now() - interval '293:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000100f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', 'qualification_completed', null, '{"score":89,"priority":"high","category":"ai_automation","executionId":"0d3e0000-0000-4000-8000-00000000100d"}'::jsonb, null, true, (now() - interval '292:59:53.350')),
  ('0d3e0000-0000-4000-8000-000000001011', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '292:59:53.350')),
  ('0d3e0000-0000-4000-8000-000000001012', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '291:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001013', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', 'status_changed', null, '{"from":"contacted","to":"proposal"}'::jsonb, null, true, (now() - interval '223:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001015', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001014', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '199:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001018', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001014', 'qualification_completed', null, '{"score":73,"priority":"high","category":"web_design","executionId":"0d3e0000-0000-4000-8000-000000001016"}'::jsonb, null, true, (now() - interval '198:59:54.071')),
  ('0d3e0000-0000-4000-8000-00000000101a', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001014', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '198:59:54.071')),
  ('0d3e0000-0000-4000-8000-00000000101b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001014', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '179:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000101d', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000101c', 'lead_created', null, '{"source":"referral"}'::jsonb, null, true, (now() - interval '482:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001020', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000101c', 'qualification_completed', null, '{"score":62,"priority":"medium","category":"mobile_app","executionId":"0d3e0000-0000-4000-8000-00000000101e"}'::jsonb, null, true, (now() - interval '481:29:58.654')),
  ('0d3e0000-0000-4000-8000-000000001021', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000101c', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '478:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001022', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000101c', 'note_added', 'Decided to postpone the app until next year. (sample note)', '{}'::jsonb, null, true, (now() - interval '332:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001023', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000101c', 'status_changed', null, '{"from":"contacted","to":"lost"}'::jsonb, null, true, (now() - interval '331:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001025', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', 'lead_created', null, '{"source":"linkedin"}'::jsonb, null, true, (now() - interval '124:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001028', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', 'qualification_completed', null, '{"score":86,"priority":"high","category":"data_analytics","executionId":"0d3e0000-0000-4000-8000-000000001026"}'::jsonb, null, true, (now() - interval '122:59:57.689')),
  ('0d3e0000-0000-4000-8000-00000000102a', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '122:59:57.689')),
  ('0d3e0000-0000-4000-8000-00000000102b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '121:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000102c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', 'status_changed', null, '{"from":"contacted","to":"qualified"}'::jsonb, null, true, (now() - interval '96:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000102e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000102d', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '729:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001031', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000102d', 'qualification_completed', null, '{"score":18,"priority":"low","category":"job_application","executionId":"0d3e0000-0000-4000-8000-00000000102f"}'::jsonb, null, true, (now() - interval '728:59:53.832')),
  ('0d3e0000-0000-4000-8000-000000001032', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000102d', 'status_changed', null, '{"from":"new","to":"disqualified"}'::jsonb, null, true, (now() - interval '723:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001034', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001033', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '83:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001037', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001033', 'qualification_completed', null, '{"score":6,"priority":"low","category":"spam","executionId":"0d3e0000-0000-4000-8000-000000001035"}'::jsonb, null, true, (now() - interval '82:59:55.418')),
  ('0d3e0000-0000-4000-8000-000000001039', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001038', 'lead_created', null, '{"source":"email"}'::jsonb, null, true, (now() - interval '366:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000103c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001038', 'qualification_completed', null, '{"score":13,"priority":"low","category":"spam","executionId":"0d3e0000-0000-4000-8000-00000000103a"}'::jsonb, null, true, (now() - interval '363:59:57.185')),
  ('0d3e0000-0000-4000-8000-00000000103e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000103d', 'lead_created', null, '{"source":"n8n"}'::jsonb, null, true, (now() - interval '56:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001041', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000103d', 'qualification_completed', null, '{"score":44,"priority":"medium","category":"support_request","executionId":"0d3e0000-0000-4000-8000-00000000103f"}'::jsonb, null, true, (now() - interval '55:59:54.807')),
  ('0d3e0000-0000-4000-8000-000000001042', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000103d', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '54:30:00.000')),
  ('0d3e0000-0000-4000-8000-000000001044', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'lead_created', null, '{"source":"event"}'::jsonb, null, true, (now() - interval '649:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001047', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'qualification_completed', null, '{"score":91,"priority":"high","category":"software_development","executionId":"0d3e0000-0000-4000-8000-000000001045"}'::jsonb, null, true, (now() - interval '647:59:58.233')),
  ('0d3e0000-0000-4000-8000-000000001049', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'notification_failed', null, '{"channel":"slack","error":"Slack webhook returned HTTP 404: no_service"}'::jsonb, null, true, (now() - interval '647:59:58.233')),
  ('0d3e0000-0000-4000-8000-00000000104a', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'note_added', 'Slack alert failed (webhook revoked); team notified manually. (sample note)', '{}'::jsonb, null, true, (now() - interval '647:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000104b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '644:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000104c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', 'status_changed', null, '{"from":"contacted","to":"proposal"}'::jsonb, null, true, (now() - interval '529:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000104e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000104d', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '250:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001051', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000104d', 'qualification_completed', null, '{"score":64,"priority":"medium","category":"ai_automation","executionId":"0d3e0000-0000-4000-8000-00000000104f"}'::jsonb, null, true, (now() - interval '249:59:54.517')),
  ('0d3e0000-0000-4000-8000-000000001052', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000104d', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '228:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001053', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000104d', 'status_changed', null, '{"from":"contacted","to":"qualified"}'::jsonb, null, true, (now() - interval '175:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001055', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001054', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '557:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001058', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001054', 'qualification_completed', null, '{"score":17,"priority":"low","category":"other","executionId":"0d3e0000-0000-4000-8000-000000001056"}'::jsonb, null, true, (now() - interval '556:59:54.594')),
  ('0d3e0000-0000-4000-8000-000000001059', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001054', 'status_changed', null, '{"from":"new","to":"disqualified"}'::jsonb, null, true, (now() - interval '531:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000105b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'lead_created', null, '{"source":"phone"}'::jsonb, null, true, (now() - interval '918:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000105e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'qualification_completed', null, '{"score":91,"priority":"high","category":"software_development","executionId":"0d3e0000-0000-4000-8000-00000000105c"}'::jsonb, null, true, (now() - interval '917:41:57.452')),
  ('0d3e0000-0000-4000-8000-000000001060', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '917:41:57.452')),
  ('0d3e0000-0000-4000-8000-000000001061', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '917:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001062', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'status_changed', null, '{"from":"contacted","to":"proposal"}'::jsonb, null, true, (now() - interval '858:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001063', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', 'status_changed', null, '{"from":"proposal","to":"won"}'::jsonb, null, true, (now() - interval '658:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001065', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '842:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001068', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'qualification_completed', null, '{"score":77,"priority":"high","category":"web_design","executionId":"0d3e0000-0000-4000-8000-000000001066"}'::jsonb, null, true, (now() - interval '841:59:54.207')),
  ('0d3e0000-0000-4000-8000-00000000106a', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '841:59:54.207')),
  ('0d3e0000-0000-4000-8000-00000000106b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '838:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000106c', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'status_changed', null, '{"from":"contacted","to":"proposal"}'::jsonb, null, true, (now() - interval '792:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000106d', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'note_added', 'Procurement chose a lower bid. (sample note)', '{}'::jsonb, null, true, (now() - interval '442:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000106e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', 'status_changed', null, '{"from":"proposal","to":"lost"}'::jsonb, null, true, (now() - interval '441:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001070', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000106f', 'lead_created', null, '{"source":"email"}'::jsonb, null, true, (now() - interval '435:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001073', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000106f', 'qualification_completed', null, '{"score":64,"priority":"medium","category":"partnership","executionId":"0d3e0000-0000-4000-8000-000000001071"}'::jsonb, null, true, (now() - interval '431:59:58.381')),
  ('0d3e0000-0000-4000-8000-000000001074', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000106f', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '409:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001076', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001075', 'lead_created', null, '{"source":"n8n"}'::jsonb, null, true, (now() - interval '146:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001079', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001075', 'qualification_completed', null, '{"score":61,"priority":"medium","category":"consulting","executionId":"0d3e0000-0000-4000-8000-000000001077"}'::jsonb, null, true, (now() - interval '145:59:54.019')),
  ('0d3e0000-0000-4000-8000-00000000107b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'lead_created', null, '{"source":"landing_page"}'::jsonb, null, true, (now() - interval '343:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000107d', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'qualification_failed', null, '{"errorCode":"ai_unavailable","executionId":"0d3e0000-0000-4000-8000-00000000107c"}'::jsonb, null, true, (now() - interval '342:59:53.224')),
  ('0d3e0000-0000-4000-8000-000000001080', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'qualification_completed', null, '{"score":86,"priority":"high","category":"mobile_app","executionId":"0d3e0000-0000-4000-8000-00000000107e"}'::jsonb, null, true, (now() - interval '342:23:58.083')),
  ('0d3e0000-0000-4000-8000-000000001082', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '342:23:58.083')),
  ('0d3e0000-0000-4000-8000-000000001083', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '338:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001084', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', 'status_changed', null, '{"from":"contacted","to":"qualified"}'::jsonb, null, true, (now() - interval '295:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001086', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001085', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '105:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001089', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001085', 'qualification_completed', null, '{"score":27,"priority":"low","category":"ai_automation","executionId":"0d3e0000-0000-4000-8000-000000001087"}'::jsonb, null, true, (now() - interval '104:59:55.066')),
  ('0d3e0000-0000-4000-8000-00000000108b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108a', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '217:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000108e', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108a', 'qualification_completed', null, '{"score":64,"priority":"medium","category":"web_design","executionId":"0d3e0000-0000-4000-8000-00000000108c"}'::jsonb, null, true, (now() - interval '216:59:54.990')),
  ('0d3e0000-0000-4000-8000-000000001090', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108f', 'lead_created', null, '{"source":"api"}'::jsonb, null, true, (now() - interval '27:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001092', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108f', 'qualification_failed', null, '{"errorCode":"ai_unavailable","executionId":"0d3e0000-0000-4000-8000-000000001091"}'::jsonb, null, true, (now() - interval '26:59:50.790')),
  ('0d3e0000-0000-4000-8000-000000001094', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000108f', 'qualification_failed', null, '{"errorCode":"ai_unavailable","executionId":"0d3e0000-0000-4000-8000-000000001093"}'::jsonb, null, true, (now() - interval '24:59:57.460')),
  ('0d3e0000-0000-4000-8000-000000001096', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001095', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '532:00:00.000')),
  ('0d3e0000-0000-4000-8000-000000001098', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001095', 'qualification_failed', null, '{"errorCode":"ai_invalid_response","executionId":"0d3e0000-0000-4000-8000-000000001097"}'::jsonb, null, true, (now() - interval '531:59:54.354')),
  ('0d3e0000-0000-4000-8000-00000000109a', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001095', 'qualification_failed', null, '{"errorCode":"ai_invalid_response","executionId":"0d3e0000-0000-4000-8000-000000001099"}'::jsonb, null, true, (now() - interval '511:59:57.303')),
  ('0d3e0000-0000-4000-8000-00000000109b', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001095', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '502:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000109d', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000109c', 'lead_created', null, '{"source":"n8n"}'::jsonb, null, true, (now() - interval '272:00:00.000')),
  ('0d3e0000-0000-4000-8000-00000000109f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000109c', 'qualification_failed', null, '{"errorCode":"ai_unavailable","executionId":"0d3e0000-0000-4000-8000-00000000109e"}'::jsonb, null, true, (now() - interval '271:59:52.690')),
  ('0d3e0000-0000-4000-8000-0000000010a1', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a0', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '5:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010a4', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a3', 'lead_created', null, '{"source":"manual"}'::jsonb, null, true, (now() - interval '2:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010a6', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a5', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '798:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010a8', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a5', 'status_changed', null, '{"from":"new","to":"disqualified"}'::jsonb, null, true, (now() - interval '795:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010aa', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a9', 'lead_created', null, '{"source":"manual"}'::jsonb, null, true, (now() - interval '1061:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010ab', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010a9', 'status_changed', null, '{"from":"new","to":"won"}'::jsonb, null, true, (now() - interval '1060:48:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010ad', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'lead_created', null, '{"source":"referral"}'::jsonb, null, true, (now() - interval '387:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010b0', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'qualification_completed', null, '{"score":69,"priority":"medium","category":"software_development","executionId":"0d3e0000-0000-4000-8000-0000000010ae"}'::jsonb, null, true, (now() - interval '386:35:57.436')),
  ('0d3e0000-0000-4000-8000-0000000010b2', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'qualification_override', 'Budget (~$45k) and a March deadline were confirmed on the discovery call; referral from an existing client.', '{"from":{"score":69,"priority":"medium"},"to":{"score":82,"priority":"high"}}'::jsonb, null, true, (now() - interval '361:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010b3', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '363:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010b4', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010ac', 'status_changed', null, '{"from":"contacted","to":"proposal"}'::jsonb, null, true, (now() - interval '287:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010b6', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', 'lead_created', null, '{"source":"website_form"}'::jsonb, null, true, (now() - interval '606:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010b9', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', 'qualification_completed', null, '{"score":76,"priority":"high","category":"software_development","executionId":"0d3e0000-0000-4000-8000-0000000010b7"}'::jsonb, null, true, (now() - interval '605:59:53.096')),
  ('0d3e0000-0000-4000-8000-0000000010bb', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', 'notification_sent', null, '{"channel":"slack"}'::jsonb, null, true, (now() - interval '605:59:53.096')),
  ('0d3e0000-0000-4000-8000-0000000010bc', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', 'status_changed', null, '{"from":"new","to":"contacted"}'::jsonb, null, true, (now() - interval '598:00:00.000')),
  ('0d3e0000-0000-4000-8000-0000000010bd', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', 'duplicate_submission', null, '{"submissionCount":2}'::jsonb, null, true, (now() - interval '486:00:00.000'));

insert into public.notification_events (id, workspace_id, lead_id, execution_id, channel, status, error, payload, is_sample, created_at) values
  ('0d3e0000-0000-4000-8000-000000001005', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001000', '0d3e0000-0000-4000-8000-000000001002', 'slack', 'sent', null, '{"leadName":"Ada Sampleton","company":"Quillfeather Analytics (Sample)","score":92,"priority":"high"}'::jsonb, true, (now() - interval '986:59:54.778')),
  ('0d3e0000-0000-4000-8000-000000001010', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000100b', '0d3e0000-0000-4000-8000-00000000100d', 'slack', 'sent', null, '{"leadName":"Ben Mockridge","company":"Tidewater Freight Co. (Sample)","score":89,"priority":"high"}'::jsonb, true, (now() - interval '292:59:53.350')),
  ('0d3e0000-0000-4000-8000-000000001019', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001014', '0d3e0000-0000-4000-8000-000000001016', 'slack', 'sent', null, '{"leadName":"Carla Lorem","company":"Copperkettle Coffee Roasters (Sample)","score":73,"priority":"high"}'::jsonb, true, (now() - interval '198:59:54.071')),
  ('0d3e0000-0000-4000-8000-000000001029', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001024', '0d3e0000-0000-4000-8000-000000001026', 'slack', 'sent', null, '{"leadName":"Elena Ipsum","company":"Harborlight Dental Group (Sample)","score":86,"priority":"high"}'::jsonb, true, (now() - interval '122:59:57.689')),
  ('0d3e0000-0000-4000-8000-000000001048', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001043', '0d3e0000-0000-4000-8000-000000001045', 'slack', 'failed', 'Slack webhook returned HTTP 404: no_service', '{"leadName":"Jonah Fakewell","company":"Cobaltwave Robotics (Sample)","score":91,"priority":"high"}'::jsonb, true, (now() - interval '647:59:58.233')),
  ('0d3e0000-0000-4000-8000-00000000105f', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000105a', '0d3e0000-0000-4000-8000-00000000105c', 'slack', 'sent', null, '{"leadName":"Mina Sampleworth","company":"Ironbark Fitness Studios (Sample)","score":91,"priority":"high"}'::jsonb, true, (now() - interval '917:41:57.452')),
  ('0d3e0000-0000-4000-8000-000000001069', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000001064', '0d3e0000-0000-4000-8000-000000001066', 'slack', 'sent', null, '{"leadName":"Nico Mockwell","company":"Fernhollow Community College (Sample)","score":77,"priority":"high"}'::jsonb, true, (now() - interval '841:59:54.207')),
  ('0d3e0000-0000-4000-8000-000000001081', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-00000000107a', '0d3e0000-0000-4000-8000-00000000107e', 'slack', 'sent', null, '{"leadName":"Quinn Stubbington","company":"Mapleway Tutors (Sample)","score":86,"priority":"high"}'::jsonb, true, (now() - interval '342:23:58.083')),
  ('0d3e0000-0000-4000-8000-0000000010ba', '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-0000000010b5', '0d3e0000-0000-4000-8000-0000000010b7', 'slack', 'sent', null, '{"leadName":"Cal Dummington","company":"Hollowbrook Games (Sample)","score":76,"priority":"high"}'::jsonb, true, (now() - interval '605:59:53.096'));

commit;
