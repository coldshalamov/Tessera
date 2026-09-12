import { describe, expect, it } from 'vitest';
import {
  encodeIntentV1,
  encodeStatementV1,
  hexToBytes,
  intentDigestHex,
  type StatementV1,
} from '@tessera/types';
import {
  verifyIntentSignature,
  verifyIntentWire,
  verifyStatementSignature,
} from '@tessera/identity';
import sigFixture from '../../../fixtures/intent-v1-signature.json';
import {
  altAddress,
  b64ToBytes,
  fixtureIntent,
  freezeIntentConsent,
  freezeStatementConsent,
  newSigner,
  nobleVerify,
} from './helpers.js';

/**
 * Replay resistance: a validly signed record from a different
 * network/program/project scope must be rejected BY THE SCOPE CHECK — the
 * signature itself verifies (it's a real Ed25519 signature on real bytes),
 * so only the explicit scope check stops the replay. Tampered wire bytes are
 * rejected by the strict decoder or by signature failure on the changed
 * digest.
 */

describe('cross-network/program/project replay', () => {
  it('a foreign-network signature verifies cryptographically but fails scope', async () => {
    const signer = await newSigner();
    const intent = { ...fixtureIntent(), contributor: signer.publicKey };
    const consent = await freezeIntentConsent(signer, intent);
    const signed = await signer.signIntent(consent.consent_id, intent);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    // No scope check → the signature itself is genuinely valid.
    const unscoped = await verifyIntentSignature(intent, signed.value.signature_base64);
    expect(unscoped.ok).toBe(true);

    // Every scope mismatch is a typed refusal.
    const wrongNet = await verifyIntentSignature(intent, signed.value.signature_base64, {
      network_genesis: altAddress(201),
    });
    expect(wrongNet.ok).toBe(false);
    if (!wrongNet.ok) expect(wrongNet.error.code).toBe('NETWORK_MISMATCH');

    const wrongProg = await verifyIntentSignature(intent, signed.value.signature_base64, {
      program_id: altAddress(202),
    });
    expect(wrongProg.ok).toBe(false);
    if (!wrongProg.ok) expect(wrongProg.error.code).toBe('PROGRAM_MISMATCH');

    const wrongProj = await verifyIntentSignature(intent, signed.value.signature_base64, {
      project_address: altAddress(203),
    });
    expect(wrongProj.ok).toBe(false);
    if (!wrongProj.ok) expect(wrongProj.error.code).toBe('PROJECT_MISMATCH');

    // Correct scope passes.
    const right = await verifyIntentSignature(intent, signed.value.signature_base64, {
      network_genesis: intent.network_genesis,
      program_id: intent.program_id,
      project_address: intent.project_address,
    });
    expect(right.ok).toBe(true);
  });

  it('statements get the same scope rejection', async () => {
    const signer = await newSigner();
    const stmt: StatementV1 = {
      format_version: 1,
      network_genesis: 'FzyYqPYZJDeb2qipvU2FVnaGYmGNfuwWnpWmgpW42imP',
      program_id: '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn',
      project_address: null,
      statement_type: 'APP_DEFINED',
      subject_ref: null,
      aux_key: null,
      payload_sha256: 'a'.repeat(64),
      declared_at: '1789166400',
      custody_mode: 'server_custodied',
    };
    const consent = await freezeStatementConsent(signer, stmt);
    const signed = await signer.signStatement(consent.consent_id, stmt);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const bad = await verifyStatementSignature(stmt, signed.value.signature_base64, signer.publicKey, {
      network_genesis: altAddress(204),
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('NETWORK_MISMATCH');
  });

  it('signature from key A over an intent naming contributor B fails SIGNER_MISMATCH upstream', async () => {
    // A cannot produce this record through IdentityPort at all.
    const a = await newSigner();
    const intent = { ...fixtureIntent(), contributor: altAddress(210) };
    const consent = await freezeIntentConsent(a, intent);
    const r = await a.signIntent(consent.consent_id, intent);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SIGNER_MISMATCH');
    expect(a.signedRecords().length).toBe(0);
  });
});

describe('tampered wire rejection', () => {
  const wire = b64ToBytes(sigFixture.wire_base64);

  it.each([0, 22, 60, 120, 130, 160, 205, 250, 300, 347])(
    'byte flip at offset %d is rejected (decode or signature)',
    async (off) => {
      const w = new Uint8Array(wire);
      w[off]! ^= 0x80;
      const r = await verifyIntentWire(w, sigFixture.signature_base64);
      expect(r.ok).toBe(false);
    },
  );

  it('a signature valid for the original digest fails on the tampered digest', async () => {
    const w = new Uint8Array(wire);
    w[250]! ^= 0x01; // inside metadata digest region
    const digest = await intentDigestHex(fixtureIntent());
    expect(digest.ok).toBe(true);
    if (!digest.ok) return;
    const tamperedDigest = await crypto.subtle.digest('SHA-256', w as Uint8Array<ArrayBuffer>);
    const ok = await nobleVerify(
      sigFixture.public_key_base58,
      sigFixture.signature_base64,
      new Uint8Array(tamperedDigest),
    );
    expect(ok).toBe(false);
    expect(hexToBytes(digest.value)).not.toEqual(new Uint8Array(tamperedDigest));
  });

  it('statement signature does not verify against a mutated statement digest', async () => {
    const signer = await newSigner();
    const stmt: StatementV1 = {
      format_version: 1,
      network_genesis: 'FzyYqPYZJDeb2qipvU2FVnaGYmGNfuwWnpWmgpW42imP',
      program_id: '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn',
      project_address: '2K8CfN8zTE59rgTjqZxeTWxTPXFUgKGoC2uVBzYa2XSq',
      statement_type: 'RETRACTION_OR_DISPUTE',
      subject_ref: altAddress(60),
      aux_key: null,
      payload_sha256: 'c'.repeat(64),
      declared_at: '1789166400',
      custody_mode: 'server_custodied',
    };
    const consent = await freezeStatementConsent(signer, stmt);
    const signed = await signer.signStatement(consent.consent_id, stmt);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const mutated = { ...stmt, payload_sha256: 'd'.repeat(64) };
    const r = await verifyStatementSignature(mutated, signed.value.signature_base64, signer.publicKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_SIGNATURE');
    expect(encodeIntentV1(fixtureIntent()).ok).toBe(true);
    expect(encodeStatementV1(stmt).ok).toBe(true);
  });
});
