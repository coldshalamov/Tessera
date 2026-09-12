import { describe, expect, it } from 'vitest';
import {
  decodeIntentV1,
  decodeStatementV1,
  encodeIntentV1,
  encodeStatementV1,
  sha256Bytes,
  type IntentV1,
  type StatementV1,
} from '@tessera/types';
import sigFixture from '../../../fixtures/intent-v1-signature.json';
import {
  altAddress,
  altDigest,
  bytesToB64,
  fixtureIntent,
  nobleVerify,
  toHex,
} from './helpers.js';

/**
 * Acceptance: EVERY field mutation flips the digest and invalidates the
 * detached signature. We mutate the golden intent field-by-field (including
 * every `references` entry), re-encode, and assert both properties. Constant
 * fields (format_version, statement_code) and structural positions are
 * mutated at the wire level and must fail decoding outright.
 */

const base = fixtureIntent();
const baseEnc = encodeIntentV1(base);
if (!baseEnc.ok) throw new Error('fixture encode failed');
const baseWire = baseEnc.value;
const baseDigest = await sha256Bytes(baseWire).then((r) => (r.ok ? r.value : new Uint8Array()));
const baseDigestHex = toHex(baseDigest);
const goldenSig = sigFixture.signature_base64;
const goldenPub = sigFixture.public_key_base58;

/** Mutated intent must still encode (valid semantic mutation), flip the digest, and break the signature. */
async function expectMutationBreaks(mutated: IntentV1) {
  const enc = encodeIntentV1(mutated);
  expect(enc.ok).toBe(true);
  if (!enc.ok) return;
  const digest = await sha256Bytes(enc.value);
  expect(digest.ok).toBe(true);
  if (!digest.ok) return;
  expect(toHex(digest.value)).not.toBe(baseDigestHex);
  const stillValid = await nobleVerify(goldenPub, goldenSig, digest.value);
  expect(stillValid).toBe(false);
}

const FIELD_MUTATIONS: ReadonlyArray<readonly [string, (i: IntentV1) => IntentV1]> = [
  ['network_genesis', (i) => ({ ...i, network_genesis: altAddress(1) })],
  ['program_id', (i) => ({ ...i, program_id: altAddress(2) })],
  ['project_address', (i) => ({ ...i, project_address: altAddress(3) })],
  ['economic_parent null→set', (i) => ({ ...i, economic_parent: altAddress(4) })],
  ['nonce', (i) => ({ ...i, nonce: 'ff0e0d0c0b0a09080706050403020100' })],
  ['contributor', (i) => ({ ...i, contributor: altAddress(5) })],
  ['name', (i) => ({ ...i, name: 'Alexandra' })],
  ['title', (i) => ({ ...i, title: 'A Different Title Entirely' })],
  ['artifact_sha256', (i) => ({ ...i, artifact_sha256: altDigest(1) })],
  ['metadata_sha256 set→null', (i) => ({ ...i, metadata_sha256: null })],
  ['metadata_sha256 set→other', (i) => ({ ...i, metadata_sha256: altDigest(7) })],
  ['terms_sha256', (i) => ({ ...i, terms_sha256: altDigest(2) })],
  ['claim_bps +1', (i) => ({ ...i, claim_bps: 1501 })],
  ['claim_bps 0', (i) => ({ ...i, claim_bps: 0 })],
  ['claim_bps 10000', (i) => ({ ...i, claim_bps: 10_000 })],
  ['declared_at +1', (i) => ({ ...i, declared_at: '1789166401' })],
  ['declared_at negative', (i) => ({ ...i, declared_at: '-1' })],
  ['custody_mode', (i) => ({ ...i, custody_mode: 'user_controlled' })],
];

describe('IntentV1 field mutations flip digest and invalidate signature', () => {
  it.each(FIELD_MUTATIONS)('field: %s', async (_name, mutate) => {
    await expectMutationBreaks(mutate(base));
  });

  it('mutating each references entry breaks the signature', async () => {
    const three: IntentV1 = {
      ...base,
      references: [altAddress(10), altAddress(11), altAddress(12)],
    };
    const enc0 = encodeIntentV1(three);
    expect(enc0.ok).toBe(true);
    if (!enc0.ok) return;
    const d0 = await sha256Bytes(enc0.value);
    expect(d0.ok).toBe(true);
    if (!d0.ok) return;
    for (let idx = 0; idx < three.references.length; idx++) {
      const mutated = {
        ...three,
        references: three.references.map((r, j) => (j === idx ? altAddress(40 + idx) : r)),
      };
      const enc = encodeIntentV1(mutated);
      expect(enc.ok).toBe(true);
      if (!enc.ok) continue;
      const d = await sha256Bytes(enc.value);
      expect(d.ok && toHex(d.value)).not.toBe(toHex(d0.value));
    }
  });

  it.each([
    ['append entry', (i: IntentV1) => ({ ...i, references: [...i.references, altAddress(20)] })],
    ['drop entry', (i: IntentV1) => ({ ...i, references: [] })],
    [
      'reorder entries',
      (i: IntentV1) => ({ ...i, references: [altAddress(21), i.references[0]!, altAddress(22)] }),
    ],
  ])('references %s breaks the signature', async (_n, mutate) => {
    await expectMutationBreaks(mutate(base));
  });
});

describe('wire-level mutations of constant/structural bytes', () => {
  const DOMAIN_LEN = 'TESSERA:CONTRIBUTION:1'.length; // 22
  const VERSION_OFF = DOMAIN_LEN;
  // refs: domain22 + ver1 + 32*3 + opt1 = offset of ref-count byte
  const REFCOUNT_OFF = DOMAIN_LEN + 1 + 32 * 3 + 1;
  const STMT_CODE_OFF = () => {
    // recompute from the decoded layout: everything except the last 10 bytes
    // (i64 declared_at + u8 custody) minus u16 claim — statement_code is the
    // byte before the final 10 bytes: wire=348, claim@336..338? Compute:
    // after terms ends at offset 336 → claim u16 @336-337, stmt u8 @338,
    // i64 @339-346, custody @347.
    return 338;
  };

  function tampered(offset: number, xor = 0xff): Uint8Array {
    const w = new Uint8Array(baseWire);
    w[offset]! ^= xor;
    return w;
  }

  it('domain byte flip fails decode and flips digest', async () => {
    const w = tampered(0);
    expect(decodeIntentV1(w).ok).toBe(false);
    const d = await sha256Bytes(w);
    expect(d.ok && toHex(d.value)).not.toBe(baseDigestHex);
  });

  it('format_version byte flip fails decode (INVALID_FORMAT_VERSION)', () => {
    const r = decodeIntentV1(tampered(VERSION_OFF));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_FORMAT_VERSION');
  });

  it('statement_code byte flip fails decode (INVALID_ENUM)', () => {
    const r = decodeIntentV1(tampered(STMT_CODE_OFF()));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ENUM');
  });

  it('option tag byte flip to 2 fails decode (INVALID_ENUM)', () => {
    const r = decodeIntentV1(tampered(DOMAIN_LEN + 1 + 32 * 3, 0x02 ^ 0x00));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ENUM');
  });

  it('references count byte to 9 fails decode (REFERENCES_OUT_OF_RANGE)', () => {
    const w = new Uint8Array(baseWire);
    w[REFCOUNT_OFF] = 9;
    const r = decodeIntentV1(w);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('REFERENCES_OUT_OF_RANGE');
  });

  it('trailing garbage bytes fail decode (WIRE_LENGTH_MISMATCH)', () => {
    const w = new Uint8Array([...baseWire, 0x00]);
    const r = decodeIntentV1(w);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('WIRE_LENGTH_MISMATCH');
  });

  it('truncated wire fails decode', () => {
    const r = decodeIntentV1(baseWire.subarray(0, baseWire.length - 5));
    expect(r.ok).toBe(false);
  });

  it('flipping a byte inside a 32-byte field keeps decode valid but flips digest and breaks sig', async () => {
    const w = tampered(DOMAIN_LEN + 1 + 5); // inside network_genesis
    const decoded = decodeIntentV1(w);
    expect(decoded.ok).toBe(true); // any 32 bytes is a valid address
    const d = await sha256Bytes(w);
    expect(d.ok && toHex(d.value)).not.toBe(baseDigestHex);
    if (!d.ok) return;
    expect(await nobleVerify(goldenPub, goldenSig, d.value)).toBe(false);
  });
});

describe('StatementV1 mutations', () => {
  const stmt: StatementV1 = {
    format_version: 1,
    network_genesis: base.network_genesis,
    program_id: base.program_id,
    project_address: base.project_address,
    statement_type: 'RELEASE_ANCHOR',
    subject_ref: altAddress(50),
    aux_key: null,
    payload_sha256: base.artifact_sha256,
    declared_at: '1789166400',
    custody_mode: 'server_custodied',
  };

  const enc0 = encodeStatementV1(stmt);
  if (!enc0.ok) throw new Error('stmt encode failed');

  const MUTS: ReadonlyArray<readonly [string, (s: StatementV1) => StatementV1]> = [
    ['network_genesis', (s) => ({ ...s, network_genesis: altAddress(51) })],
    ['program_id', (s) => ({ ...s, program_id: altAddress(52) })],
    ['project_address', (s) => ({ ...s, project_address: altAddress(53) })],
    ['project_address→null', (s) => ({ ...s, project_address: null })],
    ['statement_type', (s) => ({ ...s, statement_type: 'APP_DEFINED' })],
    ['subject_ref', (s) => ({ ...s, subject_ref: altAddress(54) })],
    ['aux_key set', (s) => ({ ...s, aux_key: altAddress(55) })],
    ['payload_sha256', (s) => ({ ...s, payload_sha256: altDigest(9) })],
    ['declared_at', (s) => ({ ...s, declared_at: '1789166401' })],
    ['custody_mode', (s) => ({ ...s, custody_mode: 'embedded_provider' })],
  ];

  it.each(MUTS)('statement field: %s', async (_n, mutate) => {
    const m = mutate(stmt);
    const enc = encodeStatementV1(m);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const d0 = await sha256Bytes(enc0.value);
    const d1 = await sha256Bytes(enc.value);
    expect(d0.ok && d1.ok).toBe(true);
    if (!d0.ok || !d1.ok) return;
    expect(toHex(d1.value)).not.toBe(toHex(d0.value));
  });

  it('statement wire trailing byte fails decode', () => {
    const w = new Uint8Array([...enc0.value, 0x01]);
    const r = decodeStatementV1(w);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('WIRE_LENGTH_MISMATCH');
  });

  it('statement wire round-trips byte-for-byte', () => {
    const d = decodeStatementV1(enc0.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value).toEqual(stmt);
    const re = encodeStatementV1(d.value);
    expect(re.ok && bytesToB64(re.value)).toBe(bytesToB64(enc0.value));
  });
});
