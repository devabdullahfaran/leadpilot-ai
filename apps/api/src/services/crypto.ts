// WebCrypto only, so the same code runs in Cloudflare Workers and Node 22 (tests).

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const TOKEN_VERSION = 'v1'
const IV_BYTES = 12
const KEY_BYTES = 32

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Accepts standard base64 and base64url, with or without padding. Throws on invalid characters. */
export function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const keyCache = new Map<string, Promise<CryptoKey>>()

function importAesKey(keyBase64: string): Promise<CryptoKey> {
  let hit = keyCache.get(keyBase64)
  if (!hit) {
    let raw: Uint8Array<ArrayBuffer>
    try {
      raw = base64Decode(keyBase64)
    } catch {
      return Promise.reject(new Error('ENCRYPTION_KEY must be base64-encoded'))
    }
    if (raw.length !== KEY_BYTES) {
      return Promise.reject(
        new Error(`ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${raw.length}). Generate one with: openssl rand -base64 32`),
      )
    }
    hit = crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    keyCache.set(keyBase64, hit)
  }
  return hit
}

/** AES-256-GCM encrypt with a base64 32-byte key. Output format: "v1.<iv b64url>.<ciphertext b64url>". */
export async function encryptSecret(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  return `${TOKEN_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`
}

/** Throws a generic error for malformed, tampered or wrong-key tokens (never echoes the token). */
export async function decryptSecret(token: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64)
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) throw new Error('Unsupported encrypted secret format')
  let iv: Uint8Array<ArrayBuffer>
  let ciphertext: Uint8Array<ArrayBuffer>
  try {
    iv = base64Decode(parts[1])
    ciphertext = base64Decode(parts[2])
  } catch {
    throw new Error('Unsupported encrypted secret format')
  }
  if (iv.length !== IV_BYTES) throw new Error('Unsupported encrypted secret format')
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    return decoder.decode(plain)
  } catch {
    throw new Error('Secret could not be decrypted (wrong key or tampered data)')
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  let hex = ''
  for (const b of digest) hex += b.toString(16).padStart(2, '0')
  return hex
}

/** Constant-time comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

/** New intake key "lpk_<32 random bytes base64url>" plus a short display prefix ("lpk_ab12…"). */
export function generateIntakeKey(): { key: string; prefix: string } {
  const key = `lpk_${base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`
  return { key, prefix: `${key.slice(0, 8)}…` }
}
