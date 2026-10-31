// Role-based write rules inside one workspace, plus column grants that keep AI fields server-managed.
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PG, asUser, createAuthUser, createMember, pgError, type TestUser } from '../helpers/auth'
import { insertLead } from '../helpers/fixtures'
import { createPgClient } from '../helpers/pg'

let db: pg.Client
let owner: TestUser
let admin: TestUser
let member: TestUser
let viewer: TestUser
let outsider: TestUser

const insertLeadAs = (user: TestUser, extra: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    workspace_id: owner.workspaceId,
    name: 'Role Test',
    email: `role-${Math.random().toString(36).slice(2, 10)}@example.test`,
    company: 'Role Co (Test)',
    message: 'Synthetic test inquiry.',
    created_by: user.id,
    ...extra,
  }
  const cols = Object.keys(values)
  return asUser(db, user.id, (c) =>
    c.query<{ id: string }>(
      `insert into public.leads (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      Object.values(values),
    ),
  )
}

beforeAll(async () => {
  db = await createPgClient()
  owner = await createAuthUser(db, { fullName: 'Olive Owner' })
  admin = await createMember(db, owner.workspaceId, 'admin')
  member = await createMember(db, owner.workspaceId, 'member')
  viewer = await createMember(db, owner.workspaceId, 'viewer')
  outsider = await createAuthUser(db, { fullName: 'Oscar Outsider' })
})

afterAll(async () => {
  await db?.end()
})

describe('lead writes by role', () => {
  it('viewer cannot insert leads', async () => {
    const err = await pgError(insertLeadAs(viewer))
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(/row-level security/)
  })

  it('viewer cannot update leads (no rows match the policy)', async () => {
    const lead = await insertLead(db, owner.workspaceId, { name: 'Original' })
    const res = await asUser(db, viewer.id, (c) => c.query("update public.leads set name = 'Changed' where id = $1", [lead.id]))
    expect(res.rowCount).toBe(0)
    expect((await db.query('select name from public.leads where id = $1', [lead.id])).rows[0].name).toBe('Original')
  })

  it('member can insert and update leads', async () => {
    const { rows } = await insertLeadAs(member)
    const res = await asUser(db, member.id, (c) => c.query("update public.leads set status = 'contacted', name = 'Updated' where id = $1", [rows[0].id]))
    expect(res.rowCount).toBe(1)
  })

  it('a lead must be created in the inserting user’s own name', async () => {
    const err = await pgError(insertLeadAs(member, { created_by: owner.id }))
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it('member cannot delete leads, admin and owner can', async () => {
    const a = await insertLead(db, owner.workspaceId)
    const b = await insertLead(db, owner.workspaceId)
    const byMember = await asUser(db, member.id, (c) => c.query('delete from public.leads where id = $1', [a.id]))
    expect(byMember.rowCount).toBe(0)
    const byViewer = await asUser(db, viewer.id, (c) => c.query('delete from public.leads where id = $1', [a.id]))
    expect(byViewer.rowCount).toBe(0)
    const byAdmin = await asUser(db, admin.id, (c) => c.query('delete from public.leads where id = $1', [a.id]))
    expect(byAdmin.rowCount).toBe(1)
    const byOwner = await asUser(db, owner.id, (c) => c.query('delete from public.leads where id = $1', [b.id]))
    expect(byOwner.rowCount).toBe(1)
  })
})

describe('server-managed columns', () => {
  const aiColumns: [string, unknown][] = [
    ['score', 95],
    ['priority', 'high'],
    ['category', 'software_development'],
    ['ai_summary', 'forged'],
    ['ai_reasoning', 'forged'],
    ['recommended_action', 'forged'],
    ['confidence', 0.99],
    ['qualification_status', 'completed'],
    ['qualification_error', null],
    ['last_qualified_at', new Date()],
    ['is_sample', true],
    ['submission_count', 5],
  ]

  it.each(aiColumns)('owner cannot update %s', async (column, value) => {
    const lead = await insertLead(db, owner.workspaceId)
    const err = await pgError(asUser(db, owner.id, (c) => c.query(`update public.leads set ${column} = $2 where id = $1`, [lead.id, value])))
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(/permission denied/)
  })

  it.each(aiColumns)('member cannot insert a lead with %s', async (column, value) => {
    const err = await pgError(insertLeadAs(member, { [column]: value }))
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(/permission denied/)
  })

  it('users cannot write qualification history directly', async () => {
    const lead = await insertLead(db, owner.workspaceId)
    const err = await pgError(
      asUser(db, owner.id, (c) =>
        c.query("insert into public.lead_qualifications (workspace_id, lead_id, source, score, priority, override_reason) values ($1, $2, 'manual', 90, 'high', 'x')", [
          owner.workspaceId,
          lead.id,
        ]),
      ),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
  })
})

describe('activities', () => {
  const insertActivityAs = (user: TestUser, leadId: string, type: string, actorId: string) =>
    asUser(db, user.id, (c) =>
      c.query('insert into public.lead_activities (workspace_id, lead_id, type, body, actor_id) values ($1, $2, $3, $4, $5)', [
        owner.workspaceId,
        leadId,
        type,
        'Synthetic note',
        actorId,
      ]),
    )

  it('member can add a note in their own name', async () => {
    const lead = await insertLead(db, owner.workspaceId)
    const res = await insertActivityAs(member, lead.id, 'note_added', member.id)
    expect(res.rowCount).toBe(1)
  })

  it.each(['lead_created', 'status_changed', 'qualification_completed', 'notification_sent'])('member cannot insert %s activities', async (type) => {
    const lead = await insertLead(db, owner.workspaceId)
    const err = await pgError(insertActivityAs(member, lead.id, type, member.id))
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it('member cannot add a note as another actor', async () => {
    const lead = await insertLead(db, owner.workspaceId)
    const err = await pgError(insertActivityAs(member, lead.id, 'note_added', owner.id))
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it('viewer cannot add notes', async () => {
    const lead = await insertLead(db, owner.workspaceId)
    const err = await pgError(insertActivityAs(viewer, lead.id, 'note_added', viewer.id))
    expect(err.code).toBe(PG.insufficientPrivilege)
  })

  it('a note cannot pin itself to a lead of another workspace', async () => {
    const foreign = await insertLead(db, outsider.workspaceId)
    const err = await pgError(insertActivityAs(member, foreign.id, 'note_added', member.id))
    expect(err.code).toBe(PG.foreignKeyViolation)
  })
})

describe('lead owner', () => {
  it('can be set to a workspace member', async () => {
    const lead = await insertLead(db, owner.workspaceId)
    const res = await asUser(db, member.id, (c) => c.query('update public.leads set owner_id = $2 where id = $1', [lead.id, viewer.id]))
    expect(res.rowCount).toBe(1)
  })

  it('cannot be set to a non-member (user update)', async () => {
    const lead = await insertLead(db, owner.workspaceId)
    const err = await pgError(asUser(db, member.id, (c) => c.query('update public.leads set owner_id = $2 where id = $1', [lead.id, outsider.id])))
    expect(err.code).toBe(PG.checkViolation)
    expect(err.message).toMatch(/owner must be a member/)
  })

  it('cannot be set to a non-member even by the service role', async () => {
    const err = await pgError(insertLead(db, owner.workspaceId, { owner_id: outsider.id }))
    expect(err.code).toBe(PG.checkViolation)
  })
})

describe('workspace settings', () => {
  it('member cannot rename the workspace, admin can', async () => {
    const byMember = await asUser(db, member.id, (c) => c.query("update public.workspaces set name = 'Member rename' where id = $1", [owner.workspaceId]))
    expect(byMember.rowCount).toBe(0)
    const byAdmin = await asUser(db, admin.id, (c) => c.query("update public.workspaces set name = 'Admin rename' where id = $1", [owner.workspaceId]))
    expect(byAdmin.rowCount).toBe(1)
  })

  it('nobody can flip is_demo or the slug through the user role', async () => {
    for (const sql of ['update public.workspaces set is_demo = true where id = $1', "update public.workspaces set slug = 'taken-slug' where id = $1"]) {
      const err = await pgError(asUser(db, owner.id, (c) => c.query(sql, [owner.workspaceId])))
      expect(err.code).toBe(PG.insufficientPrivilege)
    }
  })

  it('users can update only their own profile name', async () => {
    const own = await asUser(db, member.id, (c) => c.query("update public.profiles set full_name = 'New Name' where id = $1", [member.id]))
    expect(own.rowCount).toBe(1)
    const other = await asUser(db, member.id, (c) => c.query("update public.profiles set full_name = 'Hijack' where id = $1", [owner.id]))
    expect(other.rowCount).toBe(0)
    const email = await pgError(asUser(db, member.id, (c) => c.query("update public.profiles set email = 'x@example.test' where id = $1", [member.id])))
    expect(email.code).toBe(PG.insufficientPrivilege)
  })
})
