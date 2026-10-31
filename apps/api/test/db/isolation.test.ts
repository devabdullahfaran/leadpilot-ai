// Tenant isolation enforced by grants + RLS, exercised exactly as PostgREST would (SET ROLE + JWT claims).
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PG, asAnon, asService, asUser, createAuthUser, pgError, type TestUser } from '../helpers/auth'
import {
  insertActivity,
  insertAiUsage,
  insertExecution,
  insertIntegrationSecret,
  insertIntegrationSetting,
  insertLead,
  insertNotification,
  insertQualification,
} from '../helpers/fixtures'
import { createPgClient } from '../helpers/pg'

let db: pg.Client
let alice: TestUser
let bob: TestUser
const bobRows: Record<string, string> = {}

const count = async (c: pg.Client, sql: string, params: unknown[] = []) =>
  (await c.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n

beforeAll(async () => {
  db = await createPgClient()
  alice = await createAuthUser(db, { fullName: 'Alice Isolation' })
  bob = await createAuthUser(db, { fullName: 'Bob Isolation' })
  const lead = await insertLead(db, bob.workspaceId, { name: 'Bob Lead' })
  bobRows.lead = lead.id
  bobRows.execution = (await insertExecution(db, bob.workspaceId, { lead_id: lead.id })).id
  bobRows.qualification = (await insertQualification(db, bob.workspaceId, lead.id, { execution_id: bobRows.execution })).id
  bobRows.activity = (await insertActivity(db, bob.workspaceId, lead.id)).id
  bobRows.notification = (await insertNotification(db, bob.workspaceId, { lead_id: lead.id })).id
  bobRows.usage = (await insertAiUsage(db, bob.workspaceId, { lead_id: lead.id })).id
  await insertIntegrationSetting(db, bob.workspaceId, 'slack', { channelLabel: '#sales' })
  await insertIntegrationSecret(db, bob.workspaceId, 'intake')
  await insertLead(db, alice.workspaceId, { name: 'Alice Lead' })
})

afterAll(async () => {
  await db?.end()
})

describe('cross-tenant reads', () => {
  const tables = [
    ['leads', 'lead'],
    ['lead_qualifications', 'qualification'],
    ['lead_activities', 'activity'],
    ['workflow_executions', 'execution'],
    ['notification_events', 'notification'],
    ['ai_usage_events', 'usage'],
  ] as const

  it.each(tables)('user A cannot select user B rows from %s', async (table, key) => {
    const n = await asUser(db, alice.id, (c) => count(c, `select 1 from public.${table} where id = $1`, [bobRows[key]]))
    expect(n).toBe(0)
    // Sanity: the owner does see the row, so the zero above is RLS and not a missing fixture.
    const own = await asUser(db, bob.id, (c) => count(c, `select 1 from public.${table} where id = $1`, [bobRows[key]]))
    expect(own).toBe(1)
  })

  it('user A only sees rows of their own workspace, even without a filter', async () => {
    const workspaces = await asUser(db, alice.id, async (c) =>
      (await c.query<{ workspace_id: string }>('select distinct workspace_id from public.leads')).rows.map((r) => r.workspace_id),
    )
    expect(workspaces).toEqual([alice.workspaceId])
  })

  it('user A cannot read user B integration settings, workspace, membership or profile', async () => {
    await asUser(db, alice.id, async (c) => {
      expect(await count(c, 'select 1 from public.integration_settings where workspace_id = $1', [bob.workspaceId])).toBe(0)
      expect(await count(c, 'select 1 from public.workspaces where id = $1', [bob.workspaceId])).toBe(0)
      expect(await count(c, 'select 1 from public.workspace_members where workspace_id = $1', [bob.workspaceId])).toBe(0)
      expect(await count(c, 'select 1 from public.profiles where id = $1', [bob.id])).toBe(0)
    })
    expect(await asUser(db, bob.id, (c) => count(c, 'select 1 from public.integration_settings where workspace_id = $1', [bob.workspaceId]))).toBe(1)
  })
})

describe('cross-tenant writes', () => {
  it('user A cannot update or delete user B leads (no rows match)', async () => {
    const updated = await asUser(db, alice.id, (c) => c.query("update public.leads set name = 'pwned' where id = $1", [bobRows.lead]))
    expect(updated.rowCount).toBe(0)
    const deleted = await asUser(db, alice.id, (c) => c.query('delete from public.leads where id = $1', [bobRows.lead]))
    expect(deleted.rowCount).toBe(0)
    const { rows } = await db.query('select name from public.leads where id = $1', [bobRows.lead])
    expect(rows[0].name).toBe('Bob Lead')
  })

  it('user A cannot insert a lead into user B workspace', async () => {
    const err = await pgError(
      asUser(db, alice.id, (c) =>
        c.query(
          'insert into public.leads (workspace_id, name, email, company, message, created_by) values ($1, $2, $3, $4, $5, $6)',
          [bob.workspaceId, 'Intruder', 'intruder@example.test', 'X', 'Y', alice.id],
        ),
      ),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(/row-level security/)
  })

  it('user A cannot add a note to user B lead', async () => {
    const err = await pgError(
      asUser(db, alice.id, (c) =>
        c.query("insert into public.lead_activities (workspace_id, lead_id, type, body, actor_id) values ($1, $2, 'note_added', 'x', $3)", [
          bob.workspaceId,
          bobRows.lead,
          alice.id,
        ]),
      ),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it.each([
    ['update public.workflow_executions set status = $2 where id = $1', ['execution', 'failed']],
    ['delete from public.workflow_executions where id = $1', ['execution']],
    ['update public.lead_qualifications set score = 1 where id = $1', ['qualification']],
    ['delete from public.lead_qualifications where id = $1', ['qualification']],
    ['update public.lead_activities set body = $2 where id = $1', ['activity', 'x']],
    ['delete from public.lead_activities where id = $1', ['activity']],
    ['update public.notification_events set status = $2 where id = $1', ['notification', 'failed']],
    ['delete from public.ai_usage_events where id = $1', ['usage']],
  ] as const)('authenticated has no privilege for: %s', async (sql, [key, extra]) => {
    const params = extra === undefined ? [bobRows[key]] : [bobRows[key], extra]
    // Even the workspace owner cannot write system tables directly.
    for (const user of [alice, bob]) {
      const err = await pgError(asUser(db, user.id, (c) => c.query(sql, params)))
      expect(err.code).toBe(PG.insufficientPrivilege)
    }
  })

  it('integration settings cannot be written by users (server-managed)', async () => {
    for (const user of [alice, bob]) {
      const update = await pgError(
        asUser(db, user.id, (c) => c.query("update public.integration_settings set enabled = false where workspace_id = $1", [bob.workspaceId])),
      )
      expect(update.code).toBe(PG.insufficientPrivilege)
      const del = await pgError(asUser(db, user.id, (c) => c.query('delete from public.integration_settings where workspace_id = $1', [bob.workspaceId])))
      expect(del.code).toBe(PG.insufficientPrivilege)
    }
  })

  it('users cannot add themselves to another workspace or change their own role', async () => {
    const join = await pgError(
      asUser(db, alice.id, (c) =>
        c.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [bob.workspaceId, alice.id]),
      ),
    )
    expect(join.code).toBe(PG.insufficientPrivilege)
    const promote = await pgError(
      asUser(db, alice.id, (c) => c.query("update public.workspace_members set role = 'owner' where user_id = $1", [alice.id])),
    )
    expect(promote.code).toBe(PG.insufficientPrivilege)
  })

  it('user A cannot rename user B workspace', async () => {
    const res = await asUser(db, alice.id, (c) => c.query("update public.workspaces set name = 'pwned' where id = $1", [bob.workspaceId]))
    expect(res.rowCount).toBe(0)
  })
})

describe('integration_secrets', () => {
  it('is unreadable by authenticated users, including the workspace owner', async () => {
    for (const user of [alice, bob]) {
      const err = await pgError(asUser(db, user.id, (c) => c.query('select * from public.integration_secrets')))
      expect(err.code).toBe(PG.insufficientPrivilege)
    }
  })

  it('is unreadable by anon', async () => {
    const err = await pgError(asAnon(db, (c) => c.query('select * from public.integration_secrets')))
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it('is readable by the service role only', async () => {
    const n = await asService(db, (c) => count(c, 'select 1 from public.integration_secrets where workspace_id = $1', [bob.workspaceId]))
    expect(n).toBe(1)
  })
})

describe('anon', () => {
  it.each([
    'leads',
    'lead_qualifications',
    'lead_activities',
    'workflow_executions',
    'integration_settings',
    'notification_events',
    'ai_usage_events',
    'workspaces',
    'workspace_members',
    'profiles',
  ])('cannot read %s', async (table) => {
    const err = await pgError(asAnon(db, (c) => c.query(`select * from public.${table} limit 1`)))
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it('cannot insert leads', async () => {
    const err = await pgError(
      asAnon(db, (c) =>
        c.query('insert into public.leads (workspace_id, name, email, company, message) values ($1, $2, $3, $4, $5)', [
          bob.workspaceId,
          'Anon',
          'anon@example.test',
          'X',
          'Y',
        ]),
      ),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it('cannot call the analytics RPCs', async () => {
    for (const sql of ['select public.dashboard_summary($1)', 'select public.lead_analytics($1, 30)', 'select public.workflow_overview($1)']) {
      const err = await pgError(asAnon(db, (c) => c.query(sql, [bob.workspaceId])))
      expect(err.code).toBe(PG.insufficientPrivilege)
    }
  })
})

describe('shared workspace', () => {
  it('a member of B sees B data and B profile after being added', async () => {
    const carol = await createAuthUser(db, { fullName: 'Carol Shared' })
    await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [bob.workspaceId, carol.id])
    await asUser(db, carol.id, async (c) => {
      expect(await count(c, 'select 1 from public.leads where id = $1', [bobRows.lead])).toBe(1)
      expect(await count(c, 'select 1 from public.profiles where id = $1', [bob.id])).toBe(1)
      // Still not Alice's.
      expect(await count(c, 'select 1 from public.leads where workspace_id = $1', [alice.workspaceId])).toBe(0)
      expect(await count(c, 'select 1 from public.profiles where id = $1', [alice.id])).toBe(0)
    })
  })
})
