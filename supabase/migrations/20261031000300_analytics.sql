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
