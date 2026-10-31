import {
  duplicateCheckQuerySchema,
  leadCreateSchema,
  leadListQuerySchema,
  leadUpdateSchema,
  normalizeEmail,
  normalizePhone,
  normalizeWebsite,
  noteCreateSchema,
  qualificationOverrideSchema,
  type LeadUpdate,
} from '@leadpilot/shared'
import { Hono } from 'hono'
import { ApiError, fromPostgrest, notFound, unwrap, type PostgrestErrorLike } from '../lib/errors'
import { rangeFor, readJson, readQuery, requireWrite, uuidParam } from '../lib/http'
import {
  ACTIVITY_SELECT,
  LEAD_SELECT,
  QUALIFICATION_SELECT,
  mapActivity,
  mapLead,
  mapQualification,
  type ActivityRow,
  type LeadRow,
  type QualificationRow,
} from '../lib/mappers'
import { checkRateLimit } from '../middleware/rate-limit'
import { overrideQualification, qualifyLead } from '../services/qualification'
import type { AppEnv, Scope } from '../types'
import { actorContext } from './_context'
import { likeLiteral, logActivities, quoteFilterValue, unwrapPage, type ActivityInsert } from './_query'

export const leadRoutes = new Hono<AppEnv>()

const MAX_DUPLICATE_MATCHES = 5

/** Maps API field names to the lead columns a user may write (see column grants in the security migration). */
const UPDATABLE: Record<keyof LeadUpdate, keyof LeadRow> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  company: 'company',
  jobTitle: 'job_title',
  website: 'website',
  source: 'source',
  message: 'message',
  status: 'status',
  ownerId: 'owner_id',
}

const cleanWebsite = (website: string | null | undefined) => (website ? (normalizeWebsite(website) ?? website) : null)

async function findLeadIdByEmail(scope: Scope, email: string, excludeId?: string): Promise<string | null> {
  let query = scope.db
    .from('leads')
    .select('id')
    .eq('workspace_id', scope.workspaceId)
    .eq('email_normalized', normalizeEmail(email))
  if (excludeId) query = query.neq('id', excludeId)
  const row = unwrap(await query.limit(1).maybeSingle<{ id: string }>(), 'leads.findByEmail')
  return row?.id ?? null
}

function duplicateLead(existingLeadId: string | null) {
  return new ApiError(409, 'duplicate_lead', 'A lead with this email already exists in this workspace', {
    existingLeadId,
  })
}

/** Unique-violation on leads_workspace_email_key (a concurrent insert won the race after the pre-check). */
async function rethrowDuplicate(scope: Scope, error: PostgrestErrorLike, email: string, context: string, excludeId?: string) {
  if (error.code === '23505' && `${error.message} ${error.details ?? ''}`.includes('leads_workspace_email_key')) {
    throw duplicateLead(await findLeadIdByEmail(scope, email, excludeId))
  }
  throw fromPostgrest(error, context)
}

async function assertOwnerIsMember(scope: Scope, ownerId: string): Promise<void> {
  const row = unwrap(
    await scope.db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', scope.workspaceId)
      .eq('user_id', ownerId)
      .maybeSingle<{ user_id: string }>(),
    'leads.ownerMembership',
  )
  if (!row) {
    throw new ApiError(422, 'validation_error', 'Owner must be a member of this workspace', [
      { path: 'ownerId', message: 'Owner must be a member of this workspace' },
    ])
  }
}

async function getLeadRow(scope: Scope, id: string): Promise<LeadRow> {
  const row = unwrap(
    await scope.db
      .from('leads')
      .select(LEAD_SELECT)
      .eq('workspace_id', scope.workspaceId)
      .eq('id', id)
      .maybeSingle<LeadRow>(),
    'leads.get',
  )
  if (!row) throw notFound('Lead')
  return row
}

async function assertLeadExists(scope: Scope, id: string): Promise<void> {
  const row = unwrap(
    await scope.db
      .from('leads')
      .select('id')
      .eq('workspace_id', scope.workspaceId)
      .eq('id', id)
      .maybeSingle<{ id: string }>(),
    'leads.exists',
  )
  if (!row) throw notFound('Lead')
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

leadRoutes.get('/', async (c) => {
  const scope = c.get('scope')
  const q = readQuery(c, leadListQuerySchema)

  const build = (head: boolean) => {
    let query = scope.db
      .from('leads')
      .select(head ? 'id' : LEAD_SELECT, { count: 'exact', head })
      .eq('workspace_id', scope.workspaceId)
    if (q.status) query = query.eq('status', q.status)
    if (q.priority) query = query.eq('priority', q.priority)
    if (q.qualificationStatus) query = query.eq('qualification_status', q.qualificationStatus)
    if (q.source) query = query.eq('source', q.source)
    if (q.ownerId === 'unassigned') query = query.is('owner_id', null)
    else if (q.ownerId) query = query.eq('owner_id', q.ownerId)
    if (q.q) {
      const pattern = quoteFilterValue(`*${likeLiteral(q.q)}*`)
      query = query.or(`name.ilike.${pattern},email.ilike.${pattern},company.ilike.${pattern}`)
    }
    return query
  }

  const ascending = q.order === 'asc'
  // priority is stored as text, so ordering it directly would be alphabetical (high, low, medium). The
  // score determines the priority bands, so it is used as the ordering proxy; unscored leads sort last.
  const column = q.sort === 'priority' ? 'score' : q.sort
  let query = build(false).order(column, { ascending, nullsFirst: false })
  if (column !== 'created_at') query = query.order('created_at', { ascending: false })
  query = query.order('id', { ascending: true })

  const [from, to] = rangeFor(q.page, q.pageSize)
  const { rows, total } = await unwrapPage(
    await query.range(from, to).overrideTypes<LeadRow[], { merge: false }>(),
    () => build(true),
    'leads.list',
  )
  return c.json({ data: rows.map(mapLead), page: q.page, pageSize: q.pageSize, total })
})

leadRoutes.post('/', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'member')
  const body = await readJson(c, leadCreateSchema)

  if (body.ownerId) await assertOwnerIsMember(scope, body.ownerId)
  const existing = await findLeadIdByEmail(scope, body.email)
  if (existing) throw duplicateLead(existing)

  const { data, error } = await scope.db
    .from('leads')
    .insert({
      workspace_id: scope.workspaceId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      company: body.company,
      job_title: body.jobTitle,
      website: cleanWebsite(body.website),
      source: body.source,
      message: body.message,
      status: body.status,
      owner_id: body.ownerId ?? null,
      created_by: scope.userId,
    })
    .select(LEAD_SELECT)
    .single<LeadRow>()
  if (error) return rethrowDuplicate(scope, error, body.email, 'leads.create')

  await logActivities(c.get('serviceDb'), scope.workspaceId, [
    { lead_id: data.id, type: 'lead_created', actor_id: scope.userId, metadata: { source: data.source } },
  ])
  return c.json({ lead: mapLead(data) }, 201)
})

leadRoutes.get('/duplicates', async (c) => {
  const scope = c.get('scope')
  const q = readQuery(c, duplicateCheckQuerySchema)

  type Match = { id: string; name: string; email: string; company: string }
  const base = () => {
    let query = scope.db.from('leads').select('id, name, email, company').eq('workspace_id', scope.workspaceId)
    if (q.excludeId) query = query.neq('id', q.excludeId)
    return query
  }

  const checks: { key: 'email' | 'phone' | 'company'; run: () => PromiseLike<{ data: Match[] | null; error: PostgrestErrorLike | null }> }[] = []
  if (q.email) {
    const email = normalizeEmail(q.email)
    checks.push({ key: 'email', run: () => base().eq('email_normalized', email).limit(MAX_DUPLICATE_MATCHES).overrideTypes<Match[], { merge: false }>() })
  }
  const phone = normalizePhone(q.phone)
  if (phone) {
    checks.push({ key: 'phone', run: () => base().eq('phone_normalized', phone).limit(MAX_DUPLICATE_MATCHES).overrideTypes<Match[], { merge: false }>() })
  }
  if (q.company) {
    // ilike without wildcards = case-insensitive exact match (served by the lower(company) index).
    const company = likeLiteral(q.company)
    checks.push({ key: 'company', run: () => base().ilike('company', company).limit(MAX_DUPLICATE_MATCHES).overrideTypes<Match[], { merge: false }>() })
  }

  const results = await Promise.all(checks.map(async (check) => ({ key: check.key, rows: unwrap(await check.run(), `leads.duplicates.${check.key}`) ?? [] })))
  const matches = new Map<string, Match & { matchedOn: ('email' | 'phone' | 'company')[] }>()
  for (const { key, rows } of results) {
    for (const row of rows) {
      const hit = matches.get(row.id)
      if (hit) hit.matchedOn.push(key)
      else matches.set(row.id, { id: row.id, name: row.name, email: row.email, company: row.company, matchedOn: [key] })
    }
  }
  return c.json({ matches: [...matches.values()].slice(0, MAX_DUPLICATE_MATCHES) })
})

// ---------------------------------------------------------------------------
// Single lead
// ---------------------------------------------------------------------------

leadRoutes.get('/:id', async (c) => {
  const scope = c.get('scope')
  const id = uuidParam(c, 'id')
  return c.json(mapLead(await getLeadRow(scope, id)))
})

leadRoutes.patch('/:id', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'member')
  const id = uuidParam(c, 'id')
  const body = await readJson(c, leadUpdateSchema)
  const current = await getLeadRow(scope, id)

  const patch: Record<string, unknown> = {}
  const changed: (keyof LeadUpdate)[] = []
  for (const key of Object.keys(UPDATABLE) as (keyof LeadUpdate)[]) {
    if (!(key in body) || body[key] === undefined) continue
    const column = UPDATABLE[key]
    const value = key === 'website' ? cleanWebsite(body.website) : body[key]
    if (current[column] === value) continue
    patch[column] = value
    changed.push(key)
  }
  if (changed.length === 0) return c.json(mapLead(current))

  if (patch.owner_id) await assertOwnerIsMember(scope, patch.owner_id as string)
  if (typeof patch.email === 'string' && normalizeEmail(patch.email) !== current.email_normalized) {
    const existing = await findLeadIdByEmail(scope, patch.email, id)
    if (existing) throw duplicateLead(existing)
  }

  const { data, error } = await scope.db
    .from('leads')
    .update(patch)
    .eq('workspace_id', scope.workspaceId)
    .eq('id', id)
    .select(LEAD_SELECT)
    .maybeSingle<LeadRow>()
  if (error) return rethrowDuplicate(scope, error, String(patch.email ?? current.email), 'leads.update', id)
  if (!data) throw notFound('Lead')

  const activities: ActivityInsert[] = []
  const fieldChanges = changed.filter((k) => k !== 'status' && k !== 'ownerId')
  if (fieldChanges.length > 0) {
    activities.push({ lead_id: id, type: 'lead_updated', actor_id: scope.userId, metadata: { changedFields: fieldChanges } })
  }
  if (changed.includes('status')) {
    activities.push({ lead_id: id, type: 'status_changed', actor_id: scope.userId, metadata: { from: current.status, to: data.status } })
  }
  if (changed.includes('ownerId')) {
    activities.push({ lead_id: id, type: 'owner_changed', actor_id: scope.userId, metadata: { from: current.owner_id, to: data.owner_id } })
  }
  await logActivities(c.get('serviceDb'), scope.workspaceId, activities)
  return c.json(mapLead(data))
})

leadRoutes.delete('/:id', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  const id = uuidParam(c, 'id')
  const rows = unwrap(
    await scope.db
      .from('leads')
      .delete()
      .eq('workspace_id', scope.workspaceId)
      .eq('id', id)
      .select('id')
      .overrideTypes<{ id: string }[], { merge: false }>(),
    'leads.delete',
  )
  if (!rows || rows.length === 0) throw notFound('Lead')
  return c.body(null, 204)
})

// ---------------------------------------------------------------------------
// Timeline, notes, qualification
// ---------------------------------------------------------------------------

leadRoutes.get('/:id/activities', async (c) => {
  const scope = c.get('scope')
  const id = uuidParam(c, 'id')
  await assertLeadExists(scope, id)
  const rows = unwrap(
    await scope.db
      .from('lead_activities')
      .select(ACTIVITY_SELECT)
      .eq('workspace_id', scope.workspaceId)
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
      .overrideTypes<ActivityRow[], { merge: false }>(),
    'leads.activities',
  )
  return c.json({ data: (rows ?? []).map(mapActivity) })
})

leadRoutes.post('/:id/notes', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'member')
  const id = uuidParam(c, 'id')
  const body = await readJson(c, noteCreateSchema)
  await assertLeadExists(scope, id)
  const { data, error } = await scope.db
    .from('lead_activities')
    .insert({ workspace_id: scope.workspaceId, lead_id: id, type: 'note_added', body: body.body, actor_id: scope.userId })
    .select(ACTIVITY_SELECT)
    .single<ActivityRow>()
  if (error) throw fromPostgrest(error, 'leads.addNote')
  return c.json(mapActivity(data), 201)
})

leadRoutes.get('/:id/qualifications', async (c) => {
  const scope = c.get('scope')
  const id = uuidParam(c, 'id')
  await assertLeadExists(scope, id)
  const rows = unwrap(
    await scope.db
      .from('lead_qualifications')
      .select(QUALIFICATION_SELECT)
      .eq('workspace_id', scope.workspaceId)
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
      .overrideTypes<QualificationRow[], { merge: false }>(),
    'leads.qualifications',
  )
  return c.json({ data: (rows ?? []).map(mapQualification) })
})

leadRoutes.post('/:id/qualify', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'member')
  const id = uuidParam(c, 'id')
  await checkRateLimit(c, 'ai', `u:${scope.userId}`)
  await assertLeadExists(scope, id)
  return c.json(await qualifyLead(actorContext(c, scope), id, { trigger: 'manual' }))
})

leadRoutes.post('/:id/override', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'member')
  const id = uuidParam(c, 'id')
  const body = await readJson(c, qualificationOverrideSchema)
  await assertLeadExists(scope, id)
  return c.json(await overrideQualification(actorContext(c, scope), id, body))
})
