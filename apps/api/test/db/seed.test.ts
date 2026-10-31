// supabase/seed.sql (generated from packages/shared/src/sample-data.ts) and the sample dataset itself.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCORING_CRITERIA,
  DEMO_WORKSPACE,
  QUALIFICATION_STATUSES,
  SAMPLE_DATA_MODEL,
  SAMPLE_LEADS,
  materializeSampleData,
  priorityFromScore,
  qualificationOutcome,
} from '@leadpilot/shared'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PG, asUser, createAuthUser, pgError } from '../helpers/auth'
import { insertLead } from '../helpers/fixtures'
import { REPO_ROOT, createPgClient, insertRows } from '../helpers/pg'

let db: pg.Client
const SAMPLE_TABLES = ['leads', 'workflow_executions', 'lead_qualifications', 'lead_activities', 'notification_events'] as const
const seedSql = () => readFileSync(join(REPO_ROOT, 'supabase/seed.sql'), 'utf8')

async function workspaceCounts(ws: string) {
  const out: Record<string, { total: number; sample: number }> = {}
  for (const t of SAMPLE_TABLES) {
    const { rows } = await db.query<{ total: number; sample: number }>(
      `select count(*)::int as total, count(*) filter (where is_sample)::int as sample from public.${t} where workspace_id = $1`,
      [ws],
    )
    out[t] = rows[0]
  }
  return out
}

beforeAll(async () => {
  db = await createPgClient()
})

afterAll(async () => {
  await db?.end()
})

describe('sample dataset fixtures', () => {
  const data = materializeSampleData(new Date(), { workspaceId: DEMO_WORKSPACE.id })
  const maxByKey = new Map(DEFAULT_SCORING_CRITERIA.map((c) => [c.key, c.maxPoints]))

  it('has ~28 fictional leads on reserved domains with 555-01xx phones', () => {
    expect(data.leads.length).toBeGreaterThanOrEqual(25)
    expect(new Set(data.leads.map((l) => l.email.toLowerCase())).size).toBe(data.leads.length)
    for (const l of data.leads) {
      expect(l.email).toMatch(/@([a-z0-9-]+\.)*(example|test)$|@example\.(com|org|net)$/)
      if (l.phone) expect(l.phone).toMatch(/555-01\d\d$/)
      if (l.website) expect(new URL(l.website).hostname).toMatch(/\.(example|test)$/)
    }
  })

  it('qualification fixtures are internally consistent and never claim to be model output', () => {
    for (const q of data.qualifications) {
      expect(q.criteria.reduce((s, c) => s + c.score, 0)).toBe(q.score)
      for (const c of q.criteria) expect(c.score).toBeLessThanOrEqual(maxByKey.get(c.key) ?? -1)
      expect(q.priority).toBe(q.category === 'spam' ? 'low' : priorityFromScore(q.score))
      expect(DEFAULT_AI_SETTINGS.categories).toContain(q.category)
      if (q.source === 'ai') expect(q.model).toBe(SAMPLE_DATA_MODEL)
    }
    for (const lead of data.leads) {
      const latestAi = data.qualifications.filter((q) => q.lead_id === lead.id && q.source === 'ai').at(-1)
      const latest = data.qualifications.filter((q) => q.lead_id === lead.id).at(-1)
      if (latest) expect(lead.score).toBe(latest.score)
      if (latestAi && !data.qualifications.some((q) => q.lead_id === lead.id && q.source === 'manual')) {
        expect(lead.qualification_status).toBe(qualificationOutcome(Number(latestAi.confidence), latestAi.category))
      }
    }
  })

  it('covers every qualification status, outcome mix and engine', () => {
    const statuses = new Set(data.leads.map((l) => l.qualification_status))
    for (const s of QUALIFICATION_STATUSES.filter((s) => s !== 'processing')) expect(statuses).toContain(s)
    expect(new Set(data.leads.map((l) => l.status))).toEqual(new Set(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'disqualified']))
    const ex = data.executions
    expect(ex.filter((e) => e.status === 'succeeded').length).toBeGreaterThan(ex.length / 2)
    expect(ex.some((e) => e.status === 'partial')).toBe(true)
    expect(ex.some((e) => e.status === 'failed')).toBe(true)
    expect(ex.filter((e) => e.engine === 'n8n').length).toBeGreaterThanOrEqual(2)
    expect(ex.filter((e) => e.engine === 'n8n').length).toBeLessThanOrEqual(3)
    expect(new Set(ex.map((e) => e.error_code).filter(Boolean))).toEqual(new Set(['ai_unavailable', 'ai_invalid_response', 'integration_failed']))
    expect(new Set(data.leads.map((l) => l.created_at.slice(0, 10))).size).toBeGreaterThanOrEqual(20)
    expect(SAMPLE_LEADS).toHaveLength(data.leads.length)
  })

  it('never produces timestamps in the future', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const d = materializeSampleData(now, { workspaceId: DEMO_WORKSPACE.id })
    const all = [
      ...d.leads.flatMap((l) => [l.created_at, l.updated_at, l.last_qualified_at]),
      ...d.executions.flatMap((e) => [e.started_at, e.finished_at, ...e.steps.map((s) => s.startedAt)]),
      ...d.qualifications.map((q) => q.created_at),
      ...d.activities.map((a) => a.created_at),
    ].filter((t): t is string => t !== null)
    expect(Math.max(...all.map(Date.parse))).toBeLessThan(now.getTime())
    expect(Math.min(...all.map(Date.parse))).toBeGreaterThan(now.getTime() - 46 * 86_400_000)
  })
})

describe('seed.sql', () => {
  it('creates the single demo workspace without members', async () => {
    const { rows } = await db.query('select id, name, slug, is_demo from public.workspaces where is_demo')
    expect(rows).toEqual([{ id: DEMO_WORKSPACE.id, name: DEMO_WORKSPACE.name, slug: DEMO_WORKSPACE.slug, is_demo: true }])
    expect((await db.query('select 1 from public.workspace_members where workspace_id = $1', [DEMO_WORKSPACE.id])).rowCount).toBe(0)
  })

  it('contains only is_sample rows, matching the dataset size', async () => {
    const expected = materializeSampleData(new Date(), { workspaceId: DEMO_WORKSPACE.id })
    const counts = await workspaceCounts(DEMO_WORKSPACE.id)
    expect(counts.leads).toEqual({ total: expected.leads.length, sample: expected.leads.length })
    expect(counts.workflow_executions).toEqual({ total: expected.executions.length, sample: expected.executions.length })
    expect(counts.lead_qualifications).toEqual({ total: expected.qualifications.length, sample: expected.qualifications.length })
    expect(counts.lead_activities).toEqual({ total: expected.activities.length, sample: expected.activities.length })
    expect(counts.notification_events).toEqual({ total: expected.notifications.length, sample: expected.notifications.length })
    const usage = await db.query('select 1 from public.ai_usage_events where workspace_id = $1', [DEMO_WORKSPACE.id])
    expect(usage.rowCount).toBe(0)
    const models = await db.query("select distinct model from public.lead_qualifications where workspace_id = $1 and source = 'ai'", [DEMO_WORKSPACE.id])
    expect(models.rows).toEqual([{ model: SAMPLE_DATA_MODEL }])
  })

  it('expresses timestamps relative to now(), so the preview stays fresh', async () => {
    const { rows } = await db.query<{ newest_h: number; oldest_d: number; future: number }>(
      `select extract(epoch from now() - max(created_at))::float / 3600 as newest_h,
              extract(epoch from now() - min(created_at))::float / 86400 as oldest_d,
              (select count(*)::int from public.workflow_executions where workspace_id = $1 and finished_at > now()) as future
       from public.leads where workspace_id = $1`,
      [DEMO_WORKSPACE.id],
    )
    expect(rows[0].newest_h).toBeLessThan(24)
    expect(rows[0].oldest_d).toBeGreaterThan(40)
    expect(rows[0].oldest_d).toBeLessThan(46)
    expect(rows[0].future).toBe(0)
    const step = await db.query<{ ok: boolean }>(
      // Step timestamps are serialized with millisecond precision.
      `select bool_and((s ->> 'startedAt')::timestamptz between date_trunc('milliseconds', e.started_at) and e.finished_at) as ok
       from public.workflow_executions e, jsonb_array_elements(e.steps) s where e.workspace_id = $1`,
      [DEMO_WORKSPACE.id],
    )
    expect(step.rows[0].ok).toBe(true)
  })

  it('is idempotent and never touches other workspaces', async () => {
    const user = await createAuthUser(db)
    await insertLead(db, user.workspaceId, { email: SAMPLE_LEADS[0].email })
    const otherBefore = await db.query('select count(*)::int as n from public.leads where workspace_id <> $1', [DEMO_WORKSPACE.id])
    const before = await workspaceCounts(DEMO_WORKSPACE.id)
    const idsBefore = (await db.query('select id from public.leads where workspace_id = $1 order by id', [DEMO_WORKSPACE.id])).rows

    await db.query(seedSql())
    await db.query(seedSql())

    expect(await workspaceCounts(DEMO_WORKSPACE.id)).toEqual(before)
    expect((await db.query('select id from public.leads where workspace_id = $1 order by id', [DEMO_WORKSPACE.id])).rows).toEqual(idsBefore)
    expect((await db.query('select count(*)::int as n from public.leads where workspace_id <> $1', [DEMO_WORKSPACE.id])).rows[0]).toEqual(otherBefore.rows[0])
    expect((await db.query('select count(*)::int as n from public.workspaces where is_demo')).rows[0].n).toBe(1)
  })

  it('the demo workspace is invisible to signed-in users and a second demo workspace is impossible', async () => {
    const user = await createAuthUser(db)
    const n = await asUser(db, user.id, async (c) => (await c.query('select count(*)::int as n from public.leads where workspace_id = $1', [DEMO_WORKSPACE.id])).rows[0].n)
    expect(n).toBe(0)
    const err = await pgError(db.query("insert into public.workspaces (name, slug, is_demo) values ('Second demo', 'second-demo', true)"))
    expect(err.code).toBe(PG.uniqueViolation)
  })
})

describe('sample data in a regular workspace (what loadSampleData writes)', () => {
  it('inserts with the service-role column set, feeds the dashboard, and clears by cascade', async () => {
    const owner = await createAuthUser(db)
    const realLead = await insertLead(db, owner.workspaceId, { name: 'Real lead' })
    const data = materializeSampleData(new Date(), { workspaceId: owner.workspaceId })
    await insertRows(db, 'leads', data.leads)
    await insertRows(db, 'workflow_executions', data.executions)
    await insertRows(db, 'lead_qualifications', data.qualifications)
    await insertRows(db, 'lead_activities', data.activities)
    await insertRows(db, 'notification_events', data.notifications)

    const summary = await asUser(db, owner.id, async (c) => (await c.query('select public.dashboard_summary($1) as s', [owner.workspaceId])).rows[0].s)
    expect(summary.totals.leads).toBe(data.leads.length + 1)
    expect(summary.sampleRecordCount).toBe(data.leads.length)
    expect(summary.totals.highPriority).toBe(data.leads.filter((l) => l.priority === 'high').length)

    // Same deletes as clearSampleData.
    await db.query('delete from public.notification_events where workspace_id = $1 and is_sample', [owner.workspaceId])
    await db.query('delete from public.workflow_executions where workspace_id = $1 and is_sample', [owner.workspaceId])
    const removed = await db.query('delete from public.leads where workspace_id = $1 and is_sample', [owner.workspaceId])
    expect(removed.rowCount).toBe(data.leads.length)
    const counts = await workspaceCounts(owner.workspaceId)
    for (const t of SAMPLE_TABLES) expect(counts[t].sample).toBe(0)
    expect((await db.query('select id from public.leads where workspace_id = $1', [owner.workspaceId])).rows).toEqual([{ id: realLead.id }])
  })
})
