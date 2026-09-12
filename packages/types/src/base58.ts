/**
 * Strict base58 (Bitcoin/Solana alphabet) codec. Public keys are base58 strings
 * in JSON and 32 raw bytes on the wire. Decoding enforces the alphabet AND the
 * 32-byte decoded length — the schema pattern alone is not sufficient.
 */

export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const BASE58_MAP: ReadonlyMap<string, number> = new Map(
  [...BASE58_ALPHABET].map((c, i) => [c, i]),
);

/** JSON shape allowed for address fields per the draft schemas. */
export const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isBase58AddressShape(s: unknown): s is string {
  return typeof s === 'string' && BASE58_ADDRESS_RE.test(s);
}

/** Decode a base58 string; returns null on any non-alphabet character. */
export function base58Decode(text: string): Uint8Array | null {
  if (text.length === 0) return new Uint8Array(0);
  const bytes: number[] = [];
  for (const ch of text) {
    const digit = BASE58_MAP.get(ch);
    if (digit === undefined) return null;
    let carry = digit;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // count leading '1's (zero bytes)
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;
  const out = new Uint8Array(zeros + bytes.length);
  let j = out.length;
  for (const b of bytes) out[--j] = b;
  return out;
}

/** Encode raw bytes to base58. */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = BASE58_ALPHABET[0]!.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]!];
  return out;
}

/**
 * Decode a JSON address to its 32 raw bytes. Returns null when the shape is
 * wrong or the decoded payload is not exactly 32 bytes (a real Solana key).
 */
export function base58AddressToBytes(s: string): Uint8Array | null {
  if (!isBase58AddressShape(s)) return null;
  const raw = base58Decode(s);
  if (raw === null || raw.length !== 32) return null;
  return raw;
}
