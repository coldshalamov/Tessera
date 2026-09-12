import { describe, expect, it } from 'vitest';
import {
  base58AddressToBytes,
  decodeIntentV1,
  decodeStatementV1,
  encodeIntentV1,
  encodeStatementV1,
  hexToBytes,
  sha256Hex,
  verifyEd25519Detached,
  type IntentV1,
  type StatementV1,
} from '@tessera/types';
import { canonicalJsonStringify, intentCanonicalJson } from '@tessera/identity';
import intentFixture from '../../../fixtures/intent-v1.json';
import sigFixture from '../../../fixtures/intent-v1-signature.json';
import intentVectors from '../vectors/intent-v1-vectors.json';
import statementVectors from '../vectors/statement-v1-vectors.json';
import { b64ToBytes, bytesToB64, nobleVerify } from './helpers.js';

/**
 * Golden-vector suite: the shipped 348-byte fixture and the generated
 * tests/signatures/vectors/*.json files. Every vector must decode to its
 * declared fields, re-encode byte-for-byte, hash to its committed digest and
 * carry a verifiable detached Ed25519 signature — verified here with the
 * pure-JS @noble/ed25519 implementation (independent of the WebCrypto path
 * exercised in tests/math).
 */

const intent = intentFixture as unknown as IntentV1;

describe('fixtures/intent-v1-signature.json golden decode', () => {
  it('decodes the 348 wire bytes to the exact declared fields', () => {
    const wire = b64ToBytes(sigFixture.wire_base64);
    expect(wire.length).toBe(348);
    expect(sigFixture.wire_bytes).toBe(348);
    const decoded = decodeIntentV1(wire);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toEqual(intent);
  });

  it('re-encodes the decoded intent byte-for-byte', () => {
    const wire = b64ToBytes(sigFixture.wire_base64);
    const decoded = decodeIntentV1(wire);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const reencoded = encodeIntentV1(decoded.value);
    expect(reencoded.ok).toBe(true);
    if (!reencoded.ok) return;
    expect(reencoded.value.length).toBe(348);
    expect(reencoded.value).toEqual(wire);
    expect(bytesToB64(reencoded.value)).toBe(sigFixture.wire_base64);
  });

  it('hashes to the committed digest and verifies the shipped signature under BOTH implementations', async () => {
    const wire = b64ToBytes(sigFixture.wire_base64);
    const digest = await sha256Hex(wire);
    expect(digest.ok && digest.value).toBe(sigFixture.intent_sha256);
    const digestBytes = hexToBytes(sigFixture.intent_sha256)!;
    // noble (pure JS — what packages/identity signs with)
    const ok = await nobleVerify(
      sigFixture.public_key_base58,
      sigFixture.signature_base64,
      digestBytes,
    );
    expect(ok).toBe(true);
    // WebCrypto (the types-package verifier used by the local port)
    const ok2 = await verifyEd25519Detached(
      hexToBytes(sigFixture.public_key_hex)!,
      b64ToBytes(sigFixture.signature_base64),
      digestBytes,
    );
    expect(ok2.ok && ok2.value).toBe(true);
  });
});

interface IntentVectorCase {
  id: string;
  description: string;
  record: IntentV1;
  wire_base64: string;
  wire_bytes: number;
  digest_sha256: string;
  public_key_base58: string;
  signature_base64: string;
}

interface StatementVectorCase extends Omit<IntentVectorCase, 'record'> {
  record: StatementV1;
  payload_json?: string;
}

describe('vectors/intent-v1-vectors.json', () => {
  const cases = (intentVectors as { cases: IntentVectorCase[] }).cases;
  it('contains the expected boundary cases', () => {
    const ids = cases.map((c) => c.id);
    for (const id of [
      'absent-metadata',
      'empty-title',
      'max-name-multibyte-bound',
      'max-title-multibyte-bound',
      'references-empty',
      'references-eight',
      'child-intent-user-custody',
      'claim-zero-bps',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it.each(cases.map((c) => [c.id, c] as const))(
    'case %s: decode→fields, re-encode→wire, digest, signature',
    async (_id, c) => {
      const wire = b64ToBytes(c.wire_base64);
      expect(wire.length).toBe(c.wire_bytes);
      const decoded = decodeIntentV1(wire);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.value).toEqual(c.record);
      const reencoded = encodeIntentV1(decoded.value);
      expect(reencoded.ok).toBe(true);
      if (!reencoded.ok) return;
      expect(bytesToB64(reencoded.value)).toBe(c.wire_base64);
      const digest = await sha256Hex(wire);
      expect(digest.ok && digest.value).toBe(c.digest_sha256);
      expect(c.record.contributor).toBe(c.public_key_base58);
      const digestBytes = hexToBytes(c.digest_sha256)!;
      const ok = await nobleVerify(c.public_key_base58, c.signature_base64, digestBytes);
      expect(ok).toBe(true);
      // WebCrypto cross-verification of the same vector.
      
      const ok2 = await verifyEd25519Detached(
        base58AddressToBytes(c.public_key_base58)!,
        b64ToBytes(c.signature_base64),
        digestBytes,
      );
      expect(ok2.ok && ok2.value).toBe(true);
    },
  );
});

describe('canonical JSON view (docs/03)', () => {
  it('produces sorted-key compact JSON with decimal-string i64, integer bps, base58 keys, hex digests', () => {
    const r = intentCanonicalJson(intent);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Deterministic: same output for a key-shuffled clone.
    const shuffled = Object.fromEntries(Object.entries(intent).reverse());
    expect(canonicalJsonStringify(shuffled)).toBe(r.value);
    const back = JSON.parse(r.value) as Record<string, unknown>;
    expect(back['declared_at']).toBe('1789166400'); // i64 as decimal string
    expect(back['claim_bps']).toBe(1500); // bps as integer
    expect(typeof back['contributor']).toBe('string');
    expect(back['contributor']).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/); // base58
    expect(back['artifact_sha256']).toMatch(/^[0-9a-f]{64}$/); // hex digest
    expect(back['economic_parent']).toBeNull(); // explicit null for absent
    // Sorted keys: first key alphabetically is artifact_sha256.
    expect(Object.keys(back)).toEqual(Object.keys(back).sort());
  });

  it('canonicalJsonStringify sorts nested keys for identity-link payloads', () => {
    const a = canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } });
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('vectors/statement-v1-vectors.json', () => {
  const cases = (statementVectors as { cases: StatementVectorCase[] }).cases;
  it('contains all four statement types', () => {
    const types = new Set(cases.map((c) => c.record.statement_type));
    expect(types).toEqual(
      new Set(['APP_DEFINED', 'KEY_CONTINUITY', 'RELEASE_ANCHOR', 'RETRACTION_OR_DISPUTE']),
    );
  });

  it.each(cases.map((c) => [c.id, c] as const))(
    'case %s: decode→fields, re-encode→wire, digest, signature',
    async (_id, c) => {
      const wire = b64ToBytes(c.wire_base64);
      expect(wire.length).toBe(c.wire_bytes);
      const decoded = decodeStatementV1(wire);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.value).toEqual(c.record);
      const reencoded = encodeStatementV1(decoded.value);
      expect(reencoded.ok).toBe(true);
      if (!reencoded.ok) return;
      expect(bytesToB64(reencoded.value)).toBe(c.wire_base64);
      const digest = await sha256Hex(wire);
      expect(digest.ok && digest.value).toBe(c.digest_sha256);
      const digestBytes = hexToBytes(c.digest_sha256)!;
      const ok = await nobleVerify(c.public_key_base58, c.signature_base64, digestBytes);
      expect(ok).toBe(true);
      
      const ok2 = await verifyEd25519Detached(
        base58AddressToBytes(c.public_key_base58)!,
        b64ToBytes(c.signature_base64),
        digestBytes,
      );
      expect(ok2.ok && ok2.value).toBe(true);
    },
  );
});
