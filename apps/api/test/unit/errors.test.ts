// Security review regression: database error messages must not leak schema details or echo input.
import { describe, expect, it } from 'vitest'
import { fromPostgrest } from '../../src/lib/errors'

describe('fromPostgrest', () => {
  it('hides built-in check-constraint messages (relation and constraint names)', () => {
    const err = fromPostgrest({ code: '23514', message: 'new row for relation "leads" violates check constraint "leads_website_check"' }, 'test')
    expect(err.status).toBe(422)
    expect(err.code).toBe('validation_error')
    expect(err.message).not.toMatch(/leads|constraint|relation/)
  })

  it('keeps messages raised by our own triggers, which are written for users', () => {
    const err = fromPostgrest({ code: '23514', message: "owner must be a member of the lead's workspace" }, 'test')
    expect(err.message).toBe("owner must be a member of the lead's workspace")
  })

  it('does not echo rejected input for invalid-format and too-long errors', () => {
    for (const code of ['22P02', '22001']) {
      const err = fromPostgrest({ code, message: 'invalid input syntax for type uuid: "secret-ish input"' }, 'test')
      expect(err.status).toBe(422)
      expect(err.message).not.toMatch(/secret-ish|uuid/)
    }
  })

  it('maps unexpected errors to a generic 500', () => {
    const err = fromPostgrest({ code: 'XX000', message: 'relation "public.integration_secrets" ...' }, 'test')
    expect(err.status).toBe(500)
    expect(err.message).toBe('A database error occurred')
  })
})
