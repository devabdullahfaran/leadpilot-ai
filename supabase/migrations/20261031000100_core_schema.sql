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
