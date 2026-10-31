// Minimal in-memory stand-in for the postgrest-js query builder. It records every call and answers through a
// handler, so service logic can be unit-tested without a database. Integration tests cover real SQL.
import type { AppConfig } from '../../../src/env'
import type { Db } from '../../../src/lib/db'
import type { PipelineContext } from '../../../src/services/context'

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  payload?: unknown
  select?: string
  filters: [string, unknown][]
  single: boolean
  options?: unknown
}

export type FakeResult = { data: unknown; error: { code?: string; message: string } | null }
export type FakeHandler = (call: FakeCall) => FakeResult | undefined

class FakeQuery {
  readonly call: FakeCall
  private readonly handler: FakeHandler
  private readonly calls: FakeCall[]

  constructor(table: string, handler: FakeHandler, calls: FakeCall[], op: FakeCall['op'] = 'select', payload?: unknown) {
    this.call = { table, op, payload, filters: [], single: false }
    this.handler = handler
    this.calls = calls
  }

  select(columns = '*') {
    this.call.select = columns
    return this
  }
  insert(payload: unknown) {
    this.call.op = 'insert'
    this.call.payload = payload
    return this
  }
  update(payload: unknown) {
    this.call.op = 'update'
    this.call.payload = payload
    return this
  }
  upsert(payload: unknown, options?: unknown) {
    this.call.op = 'upsert'
    this.call.payload = payload
    this.call.options = options
    return this
  }
  delete() {
    this.call.op = 'delete'
    return this
  }
  eq(column: string, value: unknown) {
    this.call.filters.push([column, value])
    return this
  }
  single() {
    this.call.single = true
    return this
  }
  maybeSingle() {
    this.call.single = true
    return this
  }
  // Deliberately thenable: postgrest-js builders are awaited directly.
  // oxlint-disable-next-line unicorn/no-thenable
  then<T>(resolve: (value: FakeResult) => T, reject?: (reason: unknown) => T) {
    this.calls.push(this.call)
    let result: FakeResult
    try {
      result = this.handler(this.call) ?? { data: this.call.single ? null : [], error: null }
    } catch (err) {
      return Promise.reject(err).then(undefined, reject)
    }
    return Promise.resolve(result).then(resolve, reject)
  }
}

export function createFakeDb(handler: FakeHandler = () => undefined) {
  const calls: FakeCall[] = []
  const db = {
    from: (table: string) => new FakeQuery(table, handler, calls),
    rpc: (fn: string, args: unknown) => new FakeQuery(fn, handler, calls, 'rpc', args),
  }
  return { db: db as unknown as Db, calls }
}

export const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
export const ACTOR_ID = '22222222-2222-4222-8222-222222222222'

export function testConfig(overrides: { ai?: Partial<AppConfig['ai']>; gemini?: Partial<AppConfig['gemini']>; encryptionKey?: string } = {}): AppConfig {
  return {
    environment: 'test',
    supabaseUrl: 'http://localhost:54321',
    restUrl: undefined,
    publishableKey: 'sb_publishable_test',
    secretKey: 'sb_secret_test_key',
    jwtSecret: undefined,
    allowedOrigins: [],
    gemini: { apiKey: 'test-gemini-key-123', model: 'gemini-3.5-flash-lite', timeoutMs: 2000, ...overrides.gemini },
    ai: { enabled: true, dailyLimitGlobal: 150, dailyLimitPerWorkspace: 25, ...overrides.ai },
    encryptionKey: overrides.encryptionKey,
  }
}

export function testContext(
  db: Db,
  options: { config?: AppConfig; fetch?: typeof fetch; actorId?: string | null; now?: () => Date } = {},
): PipelineContext {
  return {
    config: options.config ?? testConfig(),
    serviceDb: db,
    deps: {
      externalFetch: options.fetch ?? (async () => new Response('unexpected external call', { status: 599 })),
      now: options.now ?? (() => new Date()),
    },
    workspaceId: WORKSPACE_ID,
    actorId: options.actorId === undefined ? ACTOR_ID : options.actorId,
  }
}
