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
