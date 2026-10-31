type Level = 'debug' | 'info' | 'warn' | 'error'

/**
 * Structured one-line JSON logs (picked up by Workers Observability).
 * Never pass lead PII, tokens or secrets in `fields`.
 */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
