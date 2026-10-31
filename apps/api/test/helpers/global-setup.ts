// Vitest globalSetup for the db and integration projects: recreates the local test database
// (Supabase shim + migrations + supabase/seed.sql). Runs once per Vitest process even when both projects run.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, testDbName } from './pg'

const KEY = '__leadpilotTestDbReady'

export default function setup(): void {
  const db = testDbName()
  const g = globalThis as Record<string, unknown>
  if (g[KEY] === db) return
  if (!existsSync(join(REPO_ROOT, 'supabase/seed.sql'))) {
    throw new Error('supabase/seed.sql is missing. Run: node --experimental-strip-types scripts/generate-seed.ts')
  }
  try {
    execFileSync(join(REPO_ROOT, 'scripts/db-reset-local.sh'), [db, '--seed'], { stdio: 'pipe', encoding: 'utf8' })
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string }
    throw new Error(
      `Could not reset local test database "${db}" (is PostgreSQL running and psql on PATH?).\n${e.stderr || e.stdout || e.message}`,
    )
  }
  g[KEY] = db
}
