// Direct (superuser) inserts for arranging test state. Tests then act through asUser/asAnon/asService.
import { randomUUID } from 'node:crypto'
import type { Queryable } from './pg'

type Row = Record<string, unknown>

async function insertOne<T extends Row>(client: Queryable, table: string, values: Row): Promise<T> {
  const columns = Object.keys(values)
  const params = columns.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await client.query(
    `insert into public.${table} (${columns.join(', ')}) values (${params}) returning *`,
    columns.map((c) => {
      const v = values[c]
      return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v
    }),
  )
  return rows[0] as T
}

export interface LeadFixture {
  id: string
  workspace_id: string
  email: string
  email_normalized: string
  phone_normalized: string | null
}

export function insertLead(client: Queryable, workspaceId: string, values: Row = {}): Promise<LeadFixture> {
  return insertOne<LeadFixture & Row>(client, 'leads', {
    workspace_id: workspaceId,
    name: 'Test Lead',
    email: `lead-${randomUUID().slice(0, 8)}@example.test`,
    company: 'Fixture Co (Test)',
    message: 'Synthetic test inquiry.',
    ...values,
  })
}

export function insertExecution(client: Queryable, workspaceId: string, values: Row = {}): Promise<{ id: string }> {
  return insertOne(client, 'workflow_executions', {
    workspace_id: workspaceId,
    workflow_key: 'lead_intake',
    trigger: 'test',
    status: 'succeeded',
    // Explicit start so finished_at >= started_at holds regardless of client/server clock skew.
    started_at: new Date(Date.now() - 5000),
    finished_at: new Date(Date.now() - 4990),
    duration_ms: 10,
    ...values,
  })
}

export function insertQualification(client: Queryable, workspaceId: string, leadId: string, values: Row = {}): Promise<{ id: string }> {
  return insertOne(client, 'lead_qualifications', {
    workspace_id: workspaceId,
    lead_id: leadId,
    source: 'ai',
    score: 50,
    priority: 'medium',
    model: 'test-fixture',
    ...values,
  })
}

export function insertActivity(client: Queryable, workspaceId: string, leadId: string, values: Row = {}): Promise<{ id: string }> {
  return insertOne(client, 'lead_activities', {
    workspace_id: workspaceId,
    lead_id: leadId,
    type: 'lead_created',
    ...values,
  })
}

export function insertNotification(client: Queryable, workspaceId: string, values: Row = {}): Promise<{ id: string }> {
  return insertOne(client, 'notification_events', {
    workspace_id: workspaceId,
    channel: 'slack',
    status: 'sent',
    ...values,
  })
}

export function insertIntegrationSetting(client: Queryable, workspaceId: string, provider: string, config: Row = {}): Promise<Row> {
  return insertOne(client, 'integration_settings', { workspace_id: workspaceId, provider, enabled: true, config })
}

export function insertIntegrationSecret(client: Queryable, workspaceId: string, provider: string): Promise<Row> {
  return insertOne(client, 'integration_secrets', {
    workspace_id: workspaceId,
    provider,
    secret_hash: 'a'.repeat(64),
  })
}

export function insertAiUsage(client: Queryable, workspaceId: string, values: Row = {}): Promise<{ id: string }> {
  return insertOne(client, 'ai_usage_events', { workspace_id: workspaceId, model: 'test-model', status: 'success', ...values })
}
