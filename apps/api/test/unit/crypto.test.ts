import { describe, expect, it } from 'vitest'
import {
  base64UrlEncode,
  decryptSecret,
  encryptSecret,
  generateIntakeKey,
  sha256Hex,
  timingSafeEqualHex,
} from '../../src/services/crypto'

const randomKey = (bytes = 32) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX'

describe('encryptSecret / decryptSecret', () => {
  it('round-trips and uses the v1.<iv>.<ciphertext> format', async () => {
    const key = randomKey()
    const token = await encryptSecret(WEBHOOK, key)
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
    expect(token).not.toContain('hooks.slack.com')
    expect(await decryptSecret(token, key)).toBe(WEBHOOK)
  })

  it('uses a fresh IV for every encryption', async () => {
    const key = randomKey()
    const a = await encryptSecret(WEBHOOK, key)
    const b = await encryptSecret(WEBHOOK, key)
    expect(a).not.toBe(b)
    expect(a.split('.')[1]).not.toBe(b.split('.')[1])
  })

  it('rejects tampered ciphertext', async () => {
    const key = randomKey()
    const [v, iv, ct] = (await encryptSecret(WEBHOOK, key)).split('.')
    const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)
    await expect(decryptSecret(`${v}.${iv}.${flipped}`, key)).rejects.toThrow(/could not be decrypted/)
  })

  it('rejects a different key', async () => {
    const token = await encryptSecret(WEBHOOK, randomKey())
    await expect(decryptSecret(token, randomKey())).rejects.toThrow(/could not be decrypted/)
  })

  it('rejects malformed tokens without echoing them', async () => {
    const key = randomKey()
    await expect(decryptSecret('v2.abc.def', key)).rejects.toThrow('Unsupported encrypted secret format')
    await expect(decryptSecret('not-a-token', key)).rejects.toThrow('Unsupported encrypted secret format')
  })

  it('rejects keys that are not exactly 32 bytes', async () => {
    await expect(encryptSecret('x', randomKey(16))).rejects.toThrow(/exactly 32 bytes \(got 16\)/)
    await expect(encryptSecret('x', randomKey(48))).rejects.toThrow(/exactly 32 bytes \(got 48\)/)
    await expect(encryptSecret('x', '***not base64***')).rejects.toThrow(/base64/)
  })

  it('accepts a base64url-encoded key', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const token = await encryptSecret('hello', base64UrlEncode(bytes))
    expect(await decryptSecret(token, btoa(String.fromCharCode(...bytes)))).toBe('hello')
  })
})

describe('sha256Hex', () => {
  it('matches the NIST test vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('timingSafeEqualHex', () => {
  it('compares equal-length hex strings', () => {
    expect(timingSafeEqualHex('abcdef', 'abcdef')).toBe(true)
    expect(timingSafeEqualHex('abcdef', 'ABCDEF')).toBe(true)
    expect(timingSafeEqualHex('abcdef', 'abcdee')).toBe(false)
    expect(timingSafeEqualHex('abcd', 'abcdef')).toBe(false)
    expect(timingSafeEqualHex('', '')).toBe(true)
  })
})

describe('generateIntakeKey', () => {
  it('returns lpk_ + 32 random bytes (base64url) and an 8-char display prefix', async () => {
    const { key, prefix } = generateIntakeKey()
    expect(key).toMatch(/^lpk_[A-Za-z0-9_-]{43}$/)
    expect(prefix).toBe(`${key.slice(0, 8)}…`)
    expect(generateIntakeKey().key).not.toBe(key)
    expect(await sha256Hex(key)).toMatch(/^[0-9a-f]{64}$/)
  })
})
