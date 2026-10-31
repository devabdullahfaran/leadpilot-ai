// STUB — signatures are the contract; implementation pending.

/** AES-256-GCM encrypt with a base64 32-byte key. Output format: "v1.<iv b64url>.<ciphertext b64url>". */
export async function encryptSecret(plaintext: string, keyBase64: string): Promise<string> {
  void plaintext; void keyBase64
  throw new Error('not implemented')
}

export async function decryptSecret(token: string, keyBase64: string): Promise<string> {
  void token; void keyBase64
  throw new Error('not implemented')
}

export async function sha256Hex(value: string): Promise<string> {
  void value
  throw new Error('not implemented')
}

/** Constant-time comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  void a; void b
  throw new Error('not implemented')
}

/** New intake key "lpk_<32 random bytes base64url>" plus a short display prefix ("lpk_ab12…"). */
export function generateIntakeKey(): { key: string; prefix: string } {
  throw new Error('not implemented')
}
