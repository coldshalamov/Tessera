/** Lowercase hex helpers used at JSON boundaries (digests, nonces). */

export function isLowerHex(s: unknown, chars: number): s is string {
  return typeof s === 'string' && new RegExp(`^[0-9a-f]{${chars}}$`).test(s);
}

export function hexToBytes(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

/**
 * Test-only beneficiary key decoder mirroring the Python reference `raw_key`:
 * exactly 64 lowercase hex chars encoding 32 bytes. Returns null when invalid.
 */
export function hexTestKeyToBytes(key: string): Uint8Array | null {
  if (typeof key !== 'string' || key.length !== 64 || key !== key.toLowerCase()) return null;
  const decoded = hexToBytes(key);
  if (decoded === null || decoded.length !== 32) return null;
  return decoded;
}
