/**
 * Byte helpers shared across the evidence package. Workers-safe: only
 * TextEncoder/TextDecoder and atob/btoa are used (both exist in Node >=16
 * and in Workers). No Buffer, no node:* imports anywhere in this package.
 */

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8Bytes(s: string): Uint8Array {
  return utf8Encoder.encode(s);
}

/** Strict UTF-8 decode: malformed input returns null rather than mojibake. */
export function utf8String(b: Uint8Array): string | null {
  try {
    return utf8Decoder.decode(b);
  } catch {
    return null;
  }
}

export function bytesToBase64(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export function base64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
