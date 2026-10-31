// RPCs: AI quota reservation (service role only) and RLS-scoped analytics aggregates.
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PG, asService, asUser, createAuthUser, createMember, pgError, type TestUser } from '../helpers/auth'
import { insertAiUsage, insertExecution, insertLead } from '../helpers/fixtures'
import { createPgClient } from '../helpers/pg'

let db: pg.Client

interface Reservation {
  reservation_id: string | null
  allowed: boolean
  reason: string | null
  workspace_used: number
  global_used: number
}

const reserve = (c: pg.Client, ws: string, user: string | null, workspaceLimit: number, globalLimit: number) =>
  c
    .query<Reservation>('select * from public.reserve_ai_call($1, $2, null, $3, $4, $5)', [ws, user, 'test-model', workspaceLimit, globalLimit])
    .then((r) => r.rows[0])

const globalUsedToday = async () =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.ai_usage_events
       where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
         and status not in ('rejected_quota', 'rejected_disabled')`,
    )
  ).rows[0].n

beforeAll(async () => {
  db = await createPgClient()
})

afterAll(async () => {
  await db?.end()
})

describe('reserve_ai_call', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createAuthUser(db)
  })

  it('reserves until the workspace limit, then rejects and records the rejection', async () => {
    const big = 1_000_000
    const first = await asService(db, (c) => reserve(c, user.workspaceId, user.id, 2, big))
    expect(first).toMatchObject({ allowed: true, reason: null, workspace_used: 1 })
    expect(first.reservation_id).toMatch(/^[0-9a-f-]{36}$/)
    const second = await asService(db, (c) => reserve(c, user.workspaceId, user.id, 2, big))
    expect(second).toMatchObject({ allowed: true, workspace_used: 2 })
    const third = await asService(db, (c) => reserve(c, user.workspaceId, user.id, 2, big))
    expect(third).toMatchObject({ allowed: false, reason: 'workspace_daily_limit', reservation_id: null, workspace_used: 2 })

    const { rows } = await db.query<{ status: string; error_code: string | null }>(
      'select status, error_code from public.ai_usage_events where workspace_id = $1 order by created_at, status',
      [user.workspaceId],
    )
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2)
    expect(rows.filter((r) => r.status === 'rejected_quota')).toEqual([{ status: 'rejected_quota', error_code: 'workspace_daily_limit' }])
  })

  it('rejected attempts do not count against the quota', async () => {
    const other = await createAuthUser(db)
    await insertAiUsage(db, other.workspaceId, { status: 'rejected_quota' })
    const res = await asService(db, (c) => reserve(c, other.workspaceId, other.id, 1, 1_000_000))
    expect(res).toMatchObject({ allowed: true, workspace_used: 1 })
  })

  it('enforces the global daily limit across workspaces', async () => {
    const fresh = await createAuthUser(db)
    const used = await globalUsedToday()
    const res = await asService(db, (c) => reserve(c, fresh.workspaceId, fresh.id, 100, used))
    expect(res).toMatchObject({ allowed: false, reason: 'global_daily_limit', workspace_used: 0, global_used: used })
    const ok = await asService(db, (c) => reserve(c, fresh.workspaceId, fresh.id, 100, used + 1))
    expect(ok).toMatchObject({ allowed: true, global_used: used + 1 })
  })

  it('usage from previous days does not count', async () => {
    const old = await createAuthUser(db)
    await insertAiUsage(db, old.workspaceId, { status: 'success', created_at: new Date(Date.now() - 2 * 86_400_000) })
    const res = await asService(db, (c) => reserve(c, old.workspaceId, old.id, 1, 1_000_000))
    expect(res).toMatchObject({ allowed: true, workspace_used: 1 })
  })

  it('cannot be executed by authenticated users or anon', async () => {
    const err = await pgError(asUser(db, user.id, (c) => reserve(c, user.workspaceId, user.id, 1000, 1000)))
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(/permission denied for function/)
  })
})

describe('dashboard_summary / lead_analytics / workflow_overview', () => {
  let owner: TestUser
  let viewer: TestUser
  let stranger: TestUser

  beforeAll(async () => {
    owner = await createAuthUser(db)
    viewer = await createMember(db, owner.workspaceId, 'viewer')
    stranger = await createAuthUser(db)
    const ws = owner.workspaceId
    await insertLead(db, ws, { score: 85, priority: 'high', qualification_status: 'completed', status: 'won', source: 'website_form' })
    await insertLead(db, ws, { score: 55, priority: 'medium', qualification_status: 'completed', status: 'lost', source: 'website_form' })
    await insertLead(db, ws, { score: 30, priority: 'low', qualification_status: 'needs_review', status: 'new', source: 'referral' })
    await insertLead(db, ws, { qualification_status: 'failed', status: 'contacted', source: 'api', is_sample: true })
    await insertExecution(db, ws, { status: 'succeeded' })
    await insertExecution(db, ws, { status: 'failed', error_code: 'ai_unavailable' })
    await insertExecution(db, ws, { status: 'partial', engine: 'n8n' })
    await insertAiUsage(db, ws, { status: 'success' })
    await insertAiUsage(db, ws, { status: 'error' })
    await insertAiUsage(db, ws, { status: 'rejected_quota' })
  })

  const summary = (user: TestUser, ws: string) =>
    asUser(db, user.id, async (c) => (await c.query('select public.dashboard_summary($1) as s', [ws])).rows[0].s)
  const analytics = (user: TestUser, ws: string) =>
    asUser(db, user.id, async (c) => (await c.query('select public.lead_analytics($1, 30) as a', [ws])).rows[0].a)
  const overview = (user: TestUser, ws: string) =>
    asUser(db, user.id, async (c) => (await c.query('select public.workflow_overview($1) as o', [ws])).rows[0].o)

  it('dashboard_summary returns correct counts for members (any role)', async () => {
    for (const user of [owner, viewer]) {
      const s = await summary(user, owner.workspaceId)
      expect(s.totals).toEqual({ leads: 4, qualified: 2, highPriority: 1, needsReview: 2 })
      expect(Number(s.winRate)).toBe(0.5)
      expect(s.workflowStatus).toEqual({ succeeded: 1, partial: 1, failed: 1, running: 0 })
      expect(s.aiActivity).toMatchObject({ last7Days: 2, succeeded: 1, failed: 1, todayUsed: 2 })
      expect(s.sampleRecordCount).toBe(1)
      const funnel = Object.fromEntries(s.conversion.map((r: { status: string; count: number }) => [r.status, r.count]))
      expect(funnel).toEqual({ new: 1, contacted: 1, qualified: 0, proposal: 0, won: 1, lost: 1, disqualified: 0 })
    }
  })

  it('dashboard_summary returns zeros for non-members', async () => {
    const s = await summary(stranger, owner.workspaceId)
    expect(s.totals).toEqual({ leads: 0, qualified: 0, highPriority: 0, needsReview: 0 })
    expect(s.winRate).toBeNull()
    expect(s.workflowStatus).toEqual({ succeeded: 0, partial: 0, failed: 0, running: 0 })
    expect(s.aiActivity).toEqual({ last7Days: 0, succeeded: 0, failed: 0, todayUsed: 0 })
    expect(s.sampleRecordCount).toBe(0)
    expect(s.conversion.every((r: { count: number }) => r.count === 0)).toBe(true)
  })

  it('lead_analytics returns correct aggregates for members', async () => {
    const a = await analytics(viewer, owner.workspaceId)
    expect(a.days).toBe(30)
    expect(a.leadVolume).toHaveLength(30)
    expect(a.leadVolume.reduce((sum: number, d: { count: number }) => sum + d.count, 0)).toBe(4)
    expect(a.sources).toEqual([
      { source: 'website_form', count: 2 },
      { source: 'api', count: 1 },
      { source: 'referral', count: 1 },
    ])
    expect(a.scoreDistribution).toEqual([
      { bucket: '0-19', count: 0 },
      { bucket: '20-39', count: 1 },
      { bucket: '40-59', count: 1 },
      { bucket: '60-79', count: 0 },
      { bucket: '80-100', count: 1 },
    ])
    expect(a.priorities).toEqual([
      { priority: 'high', count: 1 },
      { priority: 'medium', count: 1 },
      { priority: 'low', count: 1 },
      { priority: 'unscored', count: 1 },
    ])
    const outcomes = a.workflowOutcomes.reduce(
      (t: Record<string, number>, d: Record<string, number>) => ({ ok: t.ok + d.succeeded, part: t.part + d.partial, bad: t.bad + d.failed }),
      { ok: 0, part: 0, bad: 0 },
    )
    expect(outcomes).toEqual({ ok: 1, part: 1, bad: 1 })
    expect(a.sampleRecordCount).toBe(1)
  })

  it('lead_analytics returns zeros for non-members', async () => {
    const a = await analytics(stranger, owner.workspaceId)
    expect(a.leadVolume.every((d: { count: number }) => d.count === 0)).toBe(true)
    expect(a.sources).toEqual([])
    expect(a.priorities).toEqual([])
    expect(a.qualificationResults).toEqual([])
    expect(a.scoreDistribution.every((b: { count: number }) => b.count === 0)).toBe(true)
    expect(a.sampleRecordCount).toBe(0)
  })

  it('workflow_overview groups by workflow and engine for members only', async () => {
    const o = await overview(owner, owner.workspaceId)
    expect(o).toEqual([
      expect.objectContaining({ workflowKey: 'lead_intake', engine: 'n8n', total: 1, partial: 1 }),
      expect.objectContaining({ workflowKey: 'lead_intake', engine: 'worker', total: 2, succeeded: 1, failed: 1 }),
    ])
    expect(await overview(stranger, owner.workspaceId)).toEqual([])
  })
})
