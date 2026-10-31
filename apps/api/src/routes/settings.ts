import {
  aiSettingsSchema,
  workspaceUpdateSchema,
  type MemberSummary,
  type WorkspaceRole,
  type WorkspaceSummary,
} from '@leadpilot/shared'
import { Hono } from 'hono'
import { notFound, unwrap } from '../lib/errors'
import { readJson, requireWrite } from '../lib/http'
import { clearSampleData, loadSampleData } from '../services/sample-data'
import { getAiSettings, saveAiSettings } from '../services/settings'
import type { AppEnv } from '../types'
import { actorContext } from './_context'

export const settingsRoutes = new Hono<AppEnv>()

settingsRoutes.get('/ai', async (c) => {
  const scope = c.get('scope')
  return c.json(await getAiSettings(scope.db, scope.workspaceId))
})

settingsRoutes.put('/ai', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  const body = await readJson(c, aiSettingsSchema)
  return c.json(await saveAiSettings(actorContext(c, scope), body))
})

settingsRoutes.patch('/workspace', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  const body = await readJson(c, workspaceUpdateSchema)
  // workspaces is keyed by id; this is the workspace-isolation filter for this table.
  const row = unwrap(
    await scope.db
      .from('workspaces')
      .update({ name: body.name })
      .eq('id', scope.workspaceId)
      .select('id, name, slug, is_demo')
      .maybeSingle<{ id: string; name: string; slug: string; is_demo: boolean }>(),
    'settings.workspace',
  )
  if (!row) throw notFound('Workspace')
  const summary: WorkspaceSummary = { id: row.id, name: row.name, slug: row.slug, role: scope.role, isDemo: row.is_demo }
  return c.json(summary)
})

settingsRoutes.get('/members', async (c) => {
  const scope = c.get('scope')
  // The preview workspace has no members, and the preview must never list real people.
  if (scope.mode === 'demo') return c.json({ data: [] as MemberSummary[] })
  const rows = unwrap(
    await scope.db
      .from('workspace_members')
      .select('user_id, role, created_at, profile:profiles(full_name, email)')
      .eq('workspace_id', scope.workspaceId)
      .order('created_at', { ascending: true })
      .overrideTypes<
        { user_id: string; role: WorkspaceRole; profile: { full_name: string | null; email: string | null } | null }[],
        { merge: false }
      >(),
    'settings.members',
  )
  const data: MemberSummary[] = (rows ?? []).map((r) => ({
    userId: r.user_id,
    fullName: r.profile?.full_name ?? null,
    email: r.profile?.email ?? null,
    role: r.role,
  }))
  return c.json({ data })
})

settingsRoutes.post('/sample-data', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  return c.json(await loadSampleData(actorContext(c, scope)), 201)
})

settingsRoutes.delete('/sample-data', async (c) => {
  const scope = c.get('scope')
  requireWrite(scope, 'admin')
  return c.json(await clearSampleData(actorContext(c, scope)))
})
