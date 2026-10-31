// Starts a local PostgREST against the test database for API integration tests. Nothing is downloaded:
// the binary must already exist at <repo>/.tools/postgrest or be named by POSTGREST_BIN. When it is missing,
// startPostgrest returns null so suites can skip with postgrestMissingMessage.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { TEST_JWT_SECRET } from './jwt'
import { REPO_ROOT, pgHost, pgPort, testDbName } from './pg'

export interface PostgrestServer {
  /** Base URL without the Supabase /rest/v1 prefix; pass it as SUPABASE_REST_URL. */
  url: string
  stop(): Promise<void>
}

export function findPostgrestBinary(): string | null {
  const candidates = [process.env.POSTGREST_BIN, join(REPO_ROOT, '.tools/postgrest')].filter((p): p is string => !!p)
  return candidates.find((p) => existsSync(p)) ?? null
}

export const postgrestMissingMessage =
  'PostgREST binary not found: place it at .tools/postgrest or set POSTGREST_BIN. Skipping API integration tests.'

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

export async function startPostgrest(opts: { database?: string; jwtSecret?: string; timeoutMs?: number } = {}): Promise<PostgrestServer | null> {
  const bin = findPostgrestBinary()
  if (!bin) return null
  const port = await freePort()
  const host = pgHost()
  const db = opts.database ?? testDbName()
  // The shim creates the `authenticator` login role (password "authenticator") that switches into anon/authenticated/service_role.
  const uri = host.startsWith('/')
    ? `postgres://authenticator:authenticator@/${db}?host=${encodeURIComponent(host)}&port=${pgPort()}`
    : `postgres://authenticator:authenticator@${host}:${pgPort()}/${db}`
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: uri,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: opts.jwtSecret ?? TEST_JWT_SECRET,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_POOL: '4',
      PGRST_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d: Buffer) => (output += d.toString()))
  child.stderr.on('data', (d: Buffer) => (output += d.toString()))
  let exited = false
  child.once('exit', () => (exited = true))

  const url = `http://127.0.0.1:${port}`
  const stop = () =>
    new Promise<void>((resolve) => {
      if (exited) return resolve()
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
    })

  const deadline = Date.now() + (opts.timeoutMs ?? 15000)
  while (Date.now() < deadline) {
    if (exited) throw new Error(`PostgREST exited during startup:\n${output}`)
    try {
      const res = await fetch(`${url}/`)
      if (res.status < 500) return { url, stop }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  await stop()
  throw new Error(`PostgREST did not become ready within ${opts.timeoutMs ?? 15000} ms:\n${output}`)
}
