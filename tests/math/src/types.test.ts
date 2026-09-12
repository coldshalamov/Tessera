import { describe, expect, it } from 'vitest';
import {
  base58AddressToBytes,
  encodeIntentV1,
  encodeStatementV1,
  hexToBytes,
  intentDigestHex,
  parseEvidenceBundleV1,
  parseIntentV1,
  parseNodeRecordV1,
  parseStatementV1,
  parseU64Decimal,
  sha256Hex,
  verifyEd25519Detached,
  type IntentV1,
  type NodeRecordV1,
  type StatementV1,
} from '@tessera/types';
import intentFixture from '../../../fixtures/intent-v1.json';
import sigFixture from '../../../fixtures/intent-v1-signature.json';

/**
 * Validator and wire-codec tests. The supplied signature fixture is a golden
 * vector: encoding fixtures/intent-v1.json must reproduce wire_base64
 * byte-for-byte, its SHA-256 must equal intent_sha256, and the shipped Ed25519
 * signature must verify over that digest.
 */

const intent = intentFixture as unknown as IntentV1;

describe('IntentV1 wire codec golden vector', () => {
  it('encodes the fixture to the exact published bytes', async () => {
    const encoded = encodeIntentV1(intent);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value.length).toBe(sigFixture.wire_bytes);
    let bin = '';
    for (const b of encoded.value) bin += String.fromCharCode(b);
    expect(btoa(bin)).toBe(sigFixture.wire_base64);
    const digest = await sha256Hex(encoded.value);
    expect(digest.ok && digest.value).toBe(sigFixture.intent_sha256);
  });

  it('verifies the shipped detached Ed25519 signature over the digest', async () => {
    const digestBytes = hexToBytes(sigFixture.intent_sha256)!;
    const pub = hexToBytes(sigFixture.public_key_hex)!;
    const sig = Uint8Array.from(atob(sigFixture.signature_base64), (c) => c.charCodeAt(0));
    const ok = await verifyEd25519Detached(pub, sig, digestBytes);
    expect(ok.ok && ok.value).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    const digestBytes = hexToBytes(sigFixture.intent_sha256)!;
    const pub = hexToBytes(sigFixture.public_key_hex)!;
    const sig = Uint8Array.from(atob(sigFixture.signature_base64), (c) => c.charCodeAt(0));
    sig[0]! ^= 0xff;
    const ok = await verifyEd25519Detached(pub, sig, digestBytes);
    expect(ok.ok && ok.value).toBe(false);
  });
});

describe('parseIntentV1 semantics', () => {
  it('accepts the shipped fixture', () => {
    const r = parseIntentV1(intent);
    expect(r.ok).toBe(true);
  });

  function mutated(patch: Record<string, unknown>) {
    return { ...intent, ...patch };
  }

  it.each([
    [{ name: '' }, 'NAME_OUT_OF_RANGE'],
    [{ name: 'a'.repeat(65) }, 'NAME_OUT_OF_RANGE'],
    [{ title: 'a'.repeat(97) }, 'TITLE_OUT_OF_RANGE'],
    [{ claim_bps: 10_001 }, 'CLAIM_OUT_OF_RANGE'],
    [{ claim_bps: -1 }, 'CLAIM_OUT_OF_RANGE'],
    [{ claim_bps: 1.5 }, 'CLAIM_OUT_OF_RANGE'],
    [{ references: Array(9).fill(intent.contributor) }, 'REFERENCES_OUT_OF_RANGE'],
    [{ nonce: 'abcd' }, 'NONCE_OUT_OF_RANGE'],
    [{ artifact_sha256: 'zz'.repeat(32) }, 'INVALID_HEX'],
    [{ metadata_sha256: 'A'.repeat(64) }, 'INVALID_HEX'],
    [{ declared_at: 'not-a-number' }, 'INVALID_DECIMAL'],
    [{ declared_at: '9223372036854775808' }, 'I64_OUT_OF_RANGE'],
    [{ custody_mode: 'admin' }, 'INVALID_ENUM'],
    [{ format_version: 2 }, 'INVALID_FORMAT_VERSION'],
    [{ contributor: '0OIl' + '1'.repeat(29) }, 'INVALID_BASE58'],
    [{ economic_parent: 'not-base58!' }, 'INVALID_BASE58'],
    [{ network_genesis: '1'.repeat(45) }, 'INVALID_BASE58'],
  ] as const)('rejects %j -> %s', (patch, code) => {
    const r = parseIntentV1(mutated(patch));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });

  it('rejects unexpected and missing fields (additionalProperties: false)', () => {
    expect(parseIntentV1(mutated({ surprise: 1 })).ok).toBe(false);
    const missing = { ...intent } as Record<string, unknown>;
    delete missing['terms_sha256'];
    const r = parseIntentV1(missing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('MISSING_FIELD');
  });

  it('enforces UTF-8 byte bounds, not char counts', () => {
    expect(parseIntentV1(mutated({ name: 'é'.repeat(32) })).ok).toBe(true); // 64 bytes
    const r = parseIntentV1(mutated({ name: 'é'.repeat(33) })); // 66 bytes
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NAME_OUT_OF_RANGE');
    // Title: 96-byte boundary
    expect(parseIntentV1(mutated({ title: '€'.repeat(32) })).ok).toBe(true); // 96 bytes
    expect(parseIntentV1(mutated({ title: '€'.repeat(33) })).ok).toBe(false);
  });

  it('rejects lone surrogates and prohibited control/bidi characters', () => {
    const lone = parseIntentV1(mutated({ name: 'bad\ud800name' }));
    expect(lone.ok).toBe(false);
    if (!lone.ok) expect(lone.error.code).toBe('INVALID_UTF8');
    for (const bad of ['a\nb', 'a	B', 'evil‮name', 'bom﻿name', 'a\x7fb']) {
      const r = parseIntentV1(mutated({ name: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('PROHIBITED_CONTROL_CHARACTER');
    }
  });

  it('accepts 8 references and 0..10000 claim boundaries', () => {
    const eight = Array(8).fill(intent.contributor);
    expect(parseIntentV1(mutated({ references: eight })).ok).toBe(true);
    expect(parseIntentV1(mutated({ claim_bps: 0 })).ok).toBe(true);
    expect(parseIntentV1(mutated({ claim_bps: 10_000 })).ok).toBe(true);
  });
});

describe('StatementV1 semantics', () => {
  const base: StatementV1 = {
    format_version: 1,
    network_genesis: intent.network_genesis,
    program_id: intent.program_id,
    project_address: intent.project_address,
    statement_type: 'RELEASE_ANCHOR',
    subject_ref: intent.contributor,
    aux_key: null,
    payload_sha256: intent.artifact_sha256,
    declared_at: '1789166400',
    custody_mode: 'server_custodied',
  };

  it('accepts a valid RELEASE_ANCHOR and encodes it', () => {
    expect(parseStatementV1(base).ok).toBe(true);
    expect(encodeStatementV1(base).ok).toBe(true);
  });

  it('KEY_CONTINUITY requires aux_key', () => {
    const r = parseStatementV1({
      ...base,
      statement_type: 'KEY_CONTINUITY',
      project_address: null,
      subject_ref: null,
      aux_key: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('MISSING_FIELD');
    const withKey = parseStatementV1({
      ...base,
      statement_type: 'KEY_CONTINUITY',
      project_address: null,
      subject_ref: null,
      aux_key: intent.contributor,
    });
    expect(withKey.ok).toBe(true);
  });

  it('RELEASE_ANCHOR requires subject_ref', () => {
    const r = parseStatementV1({ ...base, subject_ref: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('MISSING_FIELD');
  });

  it('rejects unknown statement types', () => {
    const r = parseStatementV1({ ...base, statement_type: 'TRANSFER' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ENUM');
  });
});

describe('NodeRecordV1 validator', () => {
  const node: NodeRecordV1 = {
    format_version: 1,
    economic_rule: 'residual-v1',
    node_ref: {
      genesis_hash: intent.network_genesis,
      program_id: intent.program_id,
      project_address: intent.project_address,
      node_address: intent.contributor,
    },
    economic_parent: null,
    references: [],
    contributor: intent.contributor,
    name: 'Alex',
    title: 'seed',
    nonce: intent.nonce,
    intent_digest: intent.artifact_sha256,
    artifact_sha256: intent.artifact_sha256,
    metadata_sha256: null,
    metadata_schema: 'morpheus.contribution/1',
    terms_sha256: intent.terms_sha256,
    claim_bps: 1500,
    residual_in_units: '1000000000000',
    effective_units: '150000000000',
    residual_out_units: '850000000000',
    issued_total_units: '150000000000',
    own_payout_numerator_units: '150000000000',
    own_payout_denominator_units: '150000000000',
    observed_slot: '42',
    declared_at: '1789166400',
    observed_unix_time: '1789166401',
    depth: 0,
    custody_mode: 'server_custodied',
  };

  it('accepts a valid record', () => {
    expect(parseNodeRecordV1(node).ok).toBe(true);
  });

  it('rejects numerator != effective (validated cache, not editable input)', () => {
    const r = parseNodeRecordV1({ ...node, own_payout_numerator_units: '149000000000' });
    expect(r.ok).toBe(false);
  });

  it('rejects units above U and malformed decimals', () => {
    expect(parseNodeRecordV1({ ...node, effective_units: '1000000000001' }).ok).toBe(false);
    expect(parseNodeRecordV1({ ...node, effective_units: '007' }).ok).toBe(false);
    expect(parseNodeRecordV1({ ...node, observed_slot: '18446744073709551616' }).ok).toBe(false);
  });

  it('rejects depth above 1024', () => {
    const r = parseNodeRecordV1({ ...node, depth: 1025 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEPTH_OUT_OF_RANGE');
  });
});

describe('evidence bundle validator', () => {
  const bundle = {
    format_version: 1,
    selected_leaf: {
      genesis_hash: intent.network_genesis,
      program_id: intent.program_id,
      project_address: intent.project_address,
      node_address: intent.contributor,
    },
    exporter: 'test/0',
    files: [
      { path: 'records/abc.json', sha256: 'a'.repeat(64), bytes: '10', kind: 'record' },
    ],
    limitations: ['local'],
  };

  it('accepts a valid bundle', () => {
    expect(parseEvidenceBundleV1(bundle).ok).toBe(true);
  });

  it.each([
    'records/../escape.json',
    '/abs/path.json',
    'C:\\win.json',
    'records//empty.json',
    'records/./dot.json',
  ])('rejects unsafe path %s', (p) => {
    const r = parseEvidenceBundleV1({
      ...bundle,
      files: [{ path: p, sha256: 'a'.repeat(64), bytes: '1', kind: 'record' }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate paths', () => {
    const f = { path: 'records/a.json', sha256: 'a'.repeat(64), bytes: '1', kind: 'record' };
    const r = parseEvidenceBundleV1({ ...bundle, files: [f, { ...f }] });
    expect(r.ok).toBe(false);
  });
});

describe('decimal boundary parsing', () => {
  it('u64 bounds', () => {
    expect(parseU64Decimal('18446744073709551615', 'x').ok).toBe(true);
    expect(parseU64Decimal('18446744073709551616', 'x').ok).toBe(false);
    expect(parseU64Decimal('01', 'x').ok).toBe(false);
    expect(parseU64Decimal('-1', 'x').ok).toBe(false);
    expect(parseU64Decimal('1e3', 'x').ok).toBe(false);
    expect(parseU64Decimal(5, 'x').ok).toBe(false);
  });

  it('base58 decoder enforces the alphabet and 32-byte length', () => {
    expect(base58AddressToBytes('0OIl')).toBeNull();
    expect(base58AddressToBytes('1'.repeat(32))).toEqual(new Uint8Array(32));
    expect(base58AddressToBytes('1'.repeat(31))).toBeNull(); // 31 zero bytes
  });

  it('intentDigestHex matches sha256 of encoded bytes', async () => {
    const d = await intentDigestHex(intent);
    expect(d.ok && d.value).toBe(sigFixture.intent_sha256);
  });
});
