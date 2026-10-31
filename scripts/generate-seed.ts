// Generates supabase/seed.sql from the synthetic dataset in packages/shared/src/sample-data.ts.
// Run: node --experimental-strip-types scripts/generate-seed.ts
//
// The seed (re)creates the single public demo workspace and replaces its rows. Timestamps are written as
// now() - interval '...' so the preview always looks recent relative to when the seed runs.
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEMO_WORKSPACE,
  SAMPLE_CRITERIA_KEYS,
  SAMPLE_DATA_MODEL,
  SAMPLE_LEADS,
  materializeSampleData,
  sampleCriteriaTotal,
  type SampleDataset,
} from '../packages/shared/src/sample-data.ts'
import { DEFAULT_LEAD_CATEGORIES } from '../packages/shared/src/constants.ts'
import { DEFAULT_REVIEW_CONFIDENCE, DEFAULT_SCORING_CRITERIA, priorityFromScore } from '../packages/shared/src/scoring.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'supabase/seed.sql')

// Fixed reference instant: timestamps are rendered as offsets from it, which keeps the generated file stable.
const REFERENCE = new Date('2026-01-01T12:00:00.000Z')
const TIMESTAMP_COLUMNS = new Set(['created_at', 'updated_at', 'last_qualified_at', 'started_at', 'finished_at'])
const RESERVED_EMAIL = /@([a-z0-9-]+\.)*(example|test)$|@example\.(com|org|net)$/

let counter = 0x1000
const deterministicId = () => `0d3e0000-0000-4000-8000-${(counter++).toString(16).padStart(12, '0')}`

function validate(data: SampleDataset): string[] {
  const problems: string[] = []
  const categories = new Set<string>(DEFAULT_LEAD_CATEGORIES)
  const maxByKey = new Map(DEFAULT_SCORING_CRITERIA.map((c) => [c.key, c.maxPoints]))
  if (SAMPLE_CRITERIA_KEYS.some((k) => !maxByKey.has(k))) problems.push('SAMPLE_CRITERIA_KEYS do not match DEFAULT_SCORING_CRITERIA')

  const emails = new Set<string>()
  for (const spec of SAMPLE_LEADS) {
    const email = spec.email.toLowerCase()
    if (emails.has(email)) problems.push(`duplicate email ${email}`)
    emails.add(email)
    if (!RESERVED_EMAIL.test(email)) problems.push(`${email} is not on a reserved domain`)
    if (spec.phone && !/555-01\d\d$/.test(spec.phone)) problems.push(`${spec.email}: phone outside 555-01xx`)
    const age = spec.createdDaysAgo * 24 + spec.hourOffset
    const offsets = [...spec.runs.map((r) => r.atHours), ...(spec.timeline ?? []).map((t) => t.atHours), spec.override?.atHours ?? 0]
    if (Math.max(...offsets) >= age) problems.push(`${spec.email}: event scheduled after "now"`)
    const statuses = (spec.timeline ?? []).flatMap((t) => ('status' in t ? [t.status] : []))
    if ((statuses.at(-1) ?? 'new') !== spec.status) problems.push(`${spec.email}: timeline ends at ${statuses.at(-1)}, status is ${spec.status}`)

    const quals = [
      ...spec.runs.flatMap((r) => (typeof r.ai === 'object' ? [{ ...r.ai, manual: false }] : [])),
      ...(spec.override ? [{ ...spec.override, confidence: 1, outcome: 'completed' as const, manual: true }] : []),
    ]
    for (const q of quals) {
      const score = sampleCriteriaTotal(q.criteria)
      q.criteria.forEach((points, i) => {
        const max = maxByKey.get(SAMPLE_CRITERIA_KEYS[i]) ?? 0
        if (points < 0 || points > max) problems.push(`${spec.email}: ${SAMPLE_CRITERIA_KEYS[i]}=${points} exceeds ${max}`)
      })
      const expected = q.category === 'spam' ? 'low' : priorityFromScore(score)
      if (q.priority !== expected) problems.push(`${spec.email}: score ${score} maps to ${expected}, fixture says ${q.priority}`)
      if (!categories.has(q.category)) problems.push(`${spec.email}: unknown category ${q.category}`)
      const outcome = q.confidence < DEFAULT_REVIEW_CONFIDENCE || q.category === 'spam' ? 'needs_review' : 'completed'
      if (!q.manual && q.outcome !== outcome) problems.push(`${spec.email}: outcome should be ${outcome}`)
    }
  }
  if (data.qualifications.some((q) => q.source === 'ai' && q.model !== SAMPLE_DATA_MODEL)) problems.push('AI fixture without sample model')
  return problems
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`

function interval(iso: string): string {
  const ms = REFERENCE.getTime() - Date.parse(iso)
  if (ms < 0) throw new Error(`timestamp ${iso} is after the reference instant`)
  // Whole hours rather than days, so DST changes in the session time zone cannot shift relative order.
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `(now() - interval '${h}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}')`
}

const isoExpr = (iso: string) => `to_char(${interval(iso)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

function value(column: string, v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return TIMESTAMP_COLUMNS.has(column) ? interval(v) : quote(v)
  if (column === 'steps' && Array.isArray(v)) {
    // Step timestamps live inside jsonb, so they are computed relative to now() as well.
    const steps = v.map((step: { startedAt: string }) => {
      const { startedAt, ...rest } = step
      return `jsonb_build_object('startedAt', ${isoExpr(startedAt)}) || ${quote(JSON.stringify(rest))}::jsonb`
    })
    return steps.length ? `jsonb_build_array(${steps.join(', ')})` : `'[]'::jsonb`
  }
  return `${quote(JSON.stringify(v))}::jsonb`
}

function insert(table: string, rows: object[]): string {
  if (rows.length === 0) return ''
  const columns = Object.keys(rows[0])
  const values = rows.map((row) => {
    const record = row as Record<string, unknown>
    return `  (${columns.map((c) => value(c, record[c])).join(', ')})`
  })
  return `insert into public.${table} (${columns.join(', ')}) values\n${values.join(',\n')};\n`
}

const data = materializeSampleData(REFERENCE, { workspaceId: DEMO_WORKSPACE.id, newId: deterministicId })
const problems = validate(data)
if (problems.length > 0) {
  console.error(`Sample data is inconsistent:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}

const ws = quote(DEMO_WORKSPACE.id)
const sql = `-- GENERATED by scripts/generate-seed.ts from packages/shared/src/sample-data.ts. Do not edit by hand.
-- Synthetic portfolio-preview data: fictional people and companies, reserved email domains, 555-01xx phones.
-- Every row is is_sample = true. Qualification fixtures use model '${SAMPLE_DATA_MODEL}' (not AI output).
--
-- Safe to run repeatedly: it upserts the single demo workspace (fixed id) and replaces only that workspace's
-- rows. It fails instead of touching anything if another workspace already uses the demo slug or is_demo flag.
begin;
set local standard_conforming_strings = on;

insert into public.workspaces (id, name, slug, is_demo)
values (${ws}, ${quote(DEMO_WORKSPACE.name)}, ${quote(DEMO_WORKSPACE.slug)}, true)
on conflict (id) do update set name = excluded.name, slug = excluded.slug, is_demo = true;

-- The demo workspace never has members and only holds generated rows.
delete from public.notification_events where workspace_id = ${ws};
delete from public.ai_usage_events where workspace_id = ${ws};
delete from public.workflow_executions where workspace_id = ${ws};
delete from public.leads where workspace_id = ${ws};
delete from public.integration_settings where workspace_id = ${ws};
delete from public.integration_secrets where workspace_id = ${ws};
delete from public.workspace_members where workspace_id = ${ws};

${insert('leads', data.leads)}
${insert('workflow_executions', data.executions)}
${insert('lead_qualifications', data.qualifications)}
${insert('lead_activities', data.activities)}
${insert('notification_events', data.notifications)}
commit;
`

writeFileSync(OUT, sql)
console.log(
  `Wrote ${OUT}: ${data.leads.length} leads, ${data.executions.length} executions, ${data.qualifications.length} qualifications, ` +
    `${data.activities.length} activities, ${data.notifications.length} notifications.`,
)
