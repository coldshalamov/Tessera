import * as ed from '@noble/ed25519';
import {
  base58AddressToBytes,
  base58Encode,
  encodeStatementV1,
  hexToBytes,
  intentDigestHex,
  sha256Bytes,
  type IntentV1,
  type StatementV1,
} from '@tessera/types';
import {
  LocalTestSigner,
  type ConsentRequest,
  type ConsentSnapshot,
  type IdentityPort,
} from '@tessera/identity';
import intentFixture from '../../../fixtures/intent-v1.json';

export function bytesToB64(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

/** A fresh deep copy of the golden fixture intent (mutable per test). */
export function fixtureIntent(): IntentV1 {
  return structuredClone(intentFixture) as IntentV1;
}

/** Deterministic alternate base58 32-byte "address" for mutations (i → distinct). */
export function altAddress(i: number): string {
  const b = new Uint8Array(32);
  b[0] = 0xa0;
  b[31] = i & 0xff;
  b[30] = (i >> 8) & 0xff;
  return base58Encode(b);
}

export function altDigest(i: number): string {
  const b = new Uint8Array(32);
  b[0] = 0xb0;
  b[1] = i & 0xff;
  return toHex(b);
}

export async function newSigner(
  cfg: Parameters<typeof LocalTestSigner.create>[0] = {},
): Promise<LocalTestSigner> {
  const r = await LocalTestSigner.create(cfg);
  if (!r.ok) throw new Error(`signer create failed: ${r.error.code}`);
  return r.value;
}

/** The display fields a consent UI must freeze for an intent (docs/05). */
export function intentDisplay(intent: IntentV1): Record<string, string | number | null> {
  return {
    contributor: intent.contributor,
    name: intent.name,
    title: intent.title,
    economic_parent: intent.economic_parent,
    artifact_sha256: intent.artifact_sha256,
    terms_sha256: intent.terms_sha256,
    claim_bps: intent.claim_bps,
    custody_mode: intent.custody_mode,
  };
}

/** Freeze consent for the exact intent digest — the normal approval path. */
export async function freezeIntentConsent(
  signer: IdentityPort,
  intent: IntentV1,
  session_id = 'sess-test-1',
): Promise<ConsentSnapshot> {
  const digest = await intentDigestHex(intent);
  if (!digest.ok) throw new Error('digest failed');
  const req: ConsentRequest = {
    kind: 'intent',
    digest_hex: digest.value,
    display: intentDisplay(intent),
    session_id,
  };
  const r = await signer.freezeConsent(req);
  if (!r.ok) throw new Error(`freeze failed: ${r.error.code} ${r.error.message}`);
  return r.value;
}

export async function freezeStatementConsent(
  signer: IdentityPort,
  statement: StatementV1,
  session_id = 'sess-test-1',
): Promise<ConsentSnapshot> {
  const enc = encodeStatementV1(statement);
  if (!enc.ok) throw new Error('encode failed');
  const digest = await sha256Bytes(enc.value);
  if (!digest.ok) throw new Error('digest failed');
  const r = await signer.freezeConsent({
    kind: 'statement',
    digest_hex: toHex(digest.value),
    display: {
      statement_type: statement.statement_type,
      subject_ref: statement.subject_ref,
      aux_key: statement.aux_key,
      payload_sha256: statement.payload_sha256,
    },
    session_id,
  });
  if (!r.ok) throw new Error(`freeze failed: ${r.error.code}`);
  return r.value;
}

/** Detached Ed25519 over the 32-byte intent digest using raw noble — the low-level path. */
export async function signDigestRaw(secretKey: Uint8Array, digestHex: string): Promise<string> {
  return bytesToB64(await ed.signAsync(hexToBytes(digestHex)!, secretKey));
}

/** noble verify — returns false (never throws) on bad input. */
export async function nobleVerify(
  publicKeyBase58: string,
  signatureBase64: string,
  message: Uint8Array,
): Promise<boolean> {
  const pub = base58AddressToBytes(publicKeyBase58);
  if (pub === null) return false;
  try {
    return await ed.verifyAsync(b64ToBytes(signatureBase64), message, pub);
  } catch {
    return false;
  }
}
