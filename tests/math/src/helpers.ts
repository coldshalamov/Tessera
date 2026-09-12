import {
  base58Encode,
  encodeIntentV1,
  hexToBytes,
  sha256Hex,
  type IntentV1,
} from '@tessera/types';

/** mulberry32 — small deterministic PRNG for reproducible property tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randint(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function choice<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Lowercase 32-byte hex test key (i => 64-char hex), like the Python reference. */
export function testKey(i: number): string {
  return i.toString(16).padStart(64, '0');
}

export interface TestSigner {
  readonly publicKeyBase58: string;
  readonly privateKey: CryptoKey;
}

export async function makeSigner(): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKeyBase58: base58Encode(raw), privateKey: pair.privateKey };
}

function bytesToBase64(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** Sign an IntentV1 as Ed25519 over SHA256(wire bytes) — the docs/03 detached form. */
export async function signIntent(intent: IntentV1, signer: TestSigner): Promise<string> {
  const encoded = encodeIntentV1(intent);
  if (!encoded.ok) throw new Error(`encode failed: ${encoded.error.code}`);
  const digest = await sha256Hex(encoded.value);
  if (!digest.ok) throw new Error('digest failed');
  // Fresh Uint8Array<ArrayBuffer> — DOM BufferSource rejects ArrayBufferLike.
  const digestBytes = new Uint8Array(hexToBytes(digest.value)!);
  const sig = new Uint8Array(
    await crypto.subtle.sign('Ed25519', signer.privateKey, digestBytes),
  );
  return bytesToBase64(sig);
}
