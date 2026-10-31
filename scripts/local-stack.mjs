#!/usr/bin/env node
// Runs the whole app locally without any cloud account:
//   local PostgreSQL (seeded demo workspace) → PostgREST → API Worker (wrangler dev) → Vite web app.
// Only the read-only portfolio preview works in this mode (sign-in needs a Supabase project).
// Keys below are generated per run and signed with a local-only secret; they are never valid anywhere else.
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB = process.env.LEADPILOT_LOCAL_DB ?? 'leadpilot_local'
const REST_PORT = 3001
const API_PORT = 8787
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173)
const JWT_SECRET = randomBytes(32).toString('hex')
const ISSUER_BASE = 'http://127.0.0.1:54321'

const postgrest = path.join(ROOT, '.tools', 'postgrest')
if (!existsSync(postgrest)) {
  console.error('PostgREST binary missing. Run: ./scripts/get-postgrest.sh')
  process.exit(1)
}

execFileSync('bash', [path.join(ROOT, 'scripts/db-reset-local.sh'), DB, '--seed'], { stdio: 'inherit' })

const sign = (role) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d')
    .sign(new TextEncoder().encode(JWT_SECRET))
const serviceKey = await sign('service_role')
const anonKey = await sign('anon')

const children = []
const run = (name, cmd, args, opts = {}) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  const prefix = (line) => `[${name}] ${line}`
  child.stdout.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map(prefix).join('\n') + '\n'))
  child.stderr.on('data', (d) => process.stderr.write(d.toString().split('\n').filter(Boolean).map(prefix).join('\n') + '\n'))
  child.on('exit', (code) => { console.log(prefix(`exited (${code})`)); shutdown() })
  children.push(child)
}
const shutdown = () => { for (const c of children) if (!c.killed) c.kill('SIGTERM'); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const user = process.env.PGUSER ?? process.env.USER
run('rest', postgrest, [], {
  env: {
    ...process.env,
    PGRST_DB_URI: `postgres://${user}@/${DB}?host=/tmp`,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_SERVER_PORT: String(REST_PORT),
    PGRST_LOG_LEVEL: 'error',
  },
})

const vars = {
  ENVIRONMENT: 'local',
  SUPABASE_URL: ISSUER_BASE,
  SUPABASE_REST_URL: `http://127.0.0.1:${REST_PORT}`,
  SUPABASE_PUBLISHABLE_KEY: anonKey,
  SUPABASE_SECRET_KEY: serviceKey,
  SUPABASE_JWT_SECRET: JWT_SECRET,
  ALLOWED_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
  AI_ENABLED: 'false',
}
run('api', 'npx', ['wrangler', 'dev', '--port', String(API_PORT), '--ip', '127.0.0.1',
  ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: path.join(ROOT, 'apps/api') })

run('web', 'npx', ['vite', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: path.join(ROOT, 'apps/web'),
  env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${API_PORT}`, VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
})

console.log(`\nLeadPilot local preview: http://127.0.0.1:${WEB_PORT}/preview/dashboard  (Ctrl+C to stop)\n`)
