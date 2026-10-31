// Schema-level integrity: workspace pinning of child rows, duplicate detection, generated columns, signup.
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PG, asService, createAuthUser, pgError, uniqueEmail, type TestUser } from '../helpers/auth'
import { insertAiUsage, insertExecution, insertLead, insertNotification, insertQualification } from '../helpers/fixtures'
import { createPgClient } from '../helpers/pg'

let db: pg.Client
let alice: TestUser
let bob: TestUser

beforeAll(async () => {
  db = await createPgClient()
  alice = await createAuthUser(db)
  bob = await createAuthUser(db)
})

afterAll(async () => {
  await db?.end()
})

describe('cross-workspace child rows', () => {
  it('rejects a qualification whose workspace_id does not match the lead', async () => {
    const lead = await insertLead(db, bob.workspaceId)
    const err = await pgError(asService(db, (c) => insertQualification(c, alice.workspaceId, lead.id)))
    expect(err.code).toBe(PG.foreignKeyViolation)
  })

  it('rejects an activity whose workspace_id does not match the lead', async () => {
    const lead = await insertLead(db, bob.workspaceId)
    const err = await pgError(
      asService(db, (c) =>
        c.query("insert into public.lead_activities (workspace_id, lead_id, type) values ($1, $2, 'lead_created')", [alice.workspaceId, lead.id]),
      ),
    )
    expect(err.code).toBe(PG.foreignKeyViolation)
  })

  it('rejects an execution that references another workspace’s lead', async () => {
    const lead = await insertLead(db, bob.workspaceId)
    const err = await pgError(asService(db, (c) => insertExecution(c, alice.workspaceId, { lead_id: lead.id })))
    expect(err.code).toBe(PG.checkViolation)
    expect(err.message).toMatch(/different workspace/)
  })

  it('rejects moving an execution onto another workspace’s lead', async () => {
    const own = await insertLead(db, alice.workspaceId)
    const foreign = await insertLead(db, bob.workspaceId)
    const ex = await insertExecution(db, alice.workspaceId, { lead_id: own.id })
    const err = await pgError(asService(db, (c) => c.query('update public.workflow_executions set lead_id = $2 where id = $1', [ex.id, foreign.id])))
    expect(err.code).toBe(PG.checkViolation)
  })

  it('rejects notification and AI usage rows that reference another workspace’s lead', async () => {
    const lead = await insertLead(db, bob.workspaceId)
    const n = await pgError(asService(db, (c) => insertNotification(c, alice.workspaceId, { lead_id: lead.id })))
    expect(n.code).toBe(PG.checkViolation)
    const u = await pgError(asService(db, (c) => insertAiUsage(c, alice.workspaceId, { lead_id: lead.id })))
    expect(u.code).toBe(PG.checkViolation)
  })

  it('does not let a lead move to another workspace', async () => {
    const lead = await insertLead(db, alice.workspaceId)
    const err = await pgError(asService(db, (c) => c.query('update public.leads set workspace_id = $2 where id = $1', [lead.id, bob.workspaceId])))
    expect(err.code).toBe(PG.checkViolation)
    expect(err.message).toMatch(/immutable/)
  })
})

describe('duplicate detection', () => {
  it('rejects the same email (case/whitespace-insensitive) twice in one workspace', async () => {
    const email = uniqueEmail('dup')
    await insertLead(db, alice.workspaceId, { email })
    const err = await pgError(insertLead(db, alice.workspaceId, { email: email.toUpperCase() }))
    expect(err.code).toBe(PG.uniqueViolation)
  })

  it('allows the same email in a different workspace', async () => {
    const email = uniqueEmail('shared')
    await insertLead(db, alice.workspaceId, { email })
    const other = await insertLead(db, bob.workspaceId, { email })
    expect(other.email_normalized).toBe(email)
  })
})

describe('generated normalized columns', () => {
  it('normalizes email', async () => {
    const lead = await insertLead(db, alice.workspaceId, { email: 'Ada.Generated@Example.TEST' })
    expect(lead.email_normalized).toBe('ada.generated@example.test')
  })

  it.each([
    ['+1 (555) 010-0199', '+15550100199'],
    ['  +44 20 7946 0958 ', '+442079460958'],
    ['(555) 0100', '5550100'],
    ['555-01', null],
    [null, null],
  ])('normalizes phone %j to %j', async (phone, expected) => {
    const lead = await insertLead(db, alice.workspaceId, { phone })
    expect(lead.phone_normalized).toBe(expected)
  })

  it('tracks updates and cannot be written directly', async () => {
    const lead = await insertLead(db, alice.workspaceId, { phone: '555 0123 456' })
    const { rows } = await db.query('update public.leads set phone = $2 where id = $1 returning phone_normalized', [lead.id, '+1 555 0100 000'])
    expect(rows[0].phone_normalized).toBe('+15550100000')
    const err = await pgError(asService(db, (c) => c.query("update public.leads set email_normalized = 'x@example.test' where id = $1", [lead.id])))
    expect(err.code).toBe(PG.generatedAlways)
  })
})

describe('signup provisioning', () => {
  it('creates a profile, a personal workspace and an owner membership', async () => {
    const email = uniqueEmail('signup')
    const user = await createAuthUser(db, { email, fullName: '  Sam Signup  ' })
    const profile = (await db.query('select full_name, email from public.profiles where id = $1', [user.id])).rows[0]
    expect(profile).toEqual({ full_name: 'Sam Signup', email })
    const ws = (await db.query('select name, slug, is_demo, created_by from public.workspaces where id = $1', [user.workspaceId])).rows[0]
    expect(ws.name).toBe("Sam Signup's workspace")
    expect(ws.slug).toMatch(/^ws-[0-9a-f]{12}$/)
    expect(ws.is_demo).toBe(false)
    expect(ws.created_by).toBe(user.id)
    const members = (await db.query('select user_id, role from public.workspace_members where workspace_id = $1', [user.workspaceId])).rows
    expect(members).toEqual([{ user_id: user.id, role: 'owner' }])
  })

  it('falls back to the email local part when no name is given', async () => {
    const email = uniqueEmail('noname')
    const user = await createAuthUser(db, { email })
    const ws = (await db.query('select name from public.workspaces where id = $1', [user.workspaceId])).rows[0]
    expect(ws.name).toBe(`${email.split('@')[0]}'s workspace`)
    const profile = (await db.query('select full_name from public.profiles where id = $1', [user.id])).rows[0]
    expect(profile.full_name).toBeNull()
  })

  it('deleting the auth user removes profile and memberships', async () => {
    const user = await createAuthUser(db)
    await db.query('delete from auth.users where id = $1', [user.id])
    expect((await db.query('select 1 from public.profiles where id = $1', [user.id])).rowCount).toBe(0)
    expect((await db.query('select 1 from public.workspace_members where user_id = $1', [user.id])).rowCount).toBe(0)
  })
})
