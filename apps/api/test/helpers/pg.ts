// Local PostgreSQL access for DB and integration tests. No Supabase cloud: the schema is applied to a plain
// local database by scripts/db-reset-local.sh (Supabase shim + migrations + seed).
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** Database the db/integration projects reset and use. Override with LEADPILOT_TEST_DB. */
export function testDbName(): string {
  return process.env.LEADPILOT_TEST_DB || 'leadpilot_test'
}

/** PGHOST when set, otherwise the first local socket directory that has a server socket, otherwise localhost. */
export function pgHost(): string {
  if (process.env.PGHOST) return process.env.PGHOST
  const port = pgPort()
  for (const dir of ['/tmp', '/var/run/postgresql', '/private/tmp']) {
    if (existsSync(join(dir, `.s.PGSQL.${port}`))) return dir
  }
  return 'localhost'
}

export function pgPort(): number {
  return Number(process.env.PGPORT || 5432)
}

export function pgConfig(database = testDbName()): pg.ClientConfig {
  return {
    host: pgHost(),
    port: pgPort(),
    user: process.env.PGUSER || userInfo().username,
    password: process.env.PGPASSWORD,
    database,
  }
}

/** Connected client as the local superuser (bypasses RLS). Use asUser/asAnon/asService to drop privileges. */
export async function createPgClient(database = testDbName()): Promise<pg.Client> {
  const client = new pg.Client(pgConfig(database))
  await client.connect()
  return client
}

export type Queryable = Pick<pg.Client, 'query'>

/** Inserts rows the way PostgREST bulk inserts do (json_populate_recordset over the given columns). */
export async function insertRows(client: Queryable, table: string, rows: object[]): Promise<void> {
  if (rows.length === 0) return
  const columns = Object.keys(rows[0])
  const list = columns.map((c) => `"${c}"`).join(', ')
  await client.query(
    `insert into public.${table} (${list}) select ${list} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`,
    [JSON.stringify(rows)],
  )
}
