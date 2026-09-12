import { describe, expect, it } from 'vitest';
import {
  encodeStatementV1,
  parseStatementV1,
  sha256Bytes,
  type StatementV1,
} from '@tessera/types';
import {
  buildKeyContinuityLink,
  identityLinkPreimageJson,
  keyContinuityStatement,
  parseIdentityLinkPayload,
  verifyKeyContinuity,
  verifyStatementSignature,
  canonicalJsonStringify,
  IDENTITY_LINK_FORMAT,
  type IdentityPort,
} from '@tessera/identity';
import {
  altAddress,
  fixtureIntent,
  freezeStatementConsent,
  newSigner,
  toHex,
} from './helpers.js';

/**
 * KEY_CONTINUITY (docs/05, docs/14): the old key signs a StatementV1 whose
 * aux_key names the new key; payload_sha256 commits a canonical identity-link
 * JSON embedding the new key's countersignature over the link preimage.
 * Verification must surface unproven/fraudulent links as continuity CLAIMS —
 * never silently accept — and even a fully verified link carries
 * requires_dispute_check, because a compromised old key can sign a fraudulent
 * rotation.
 */

const intent = fixtureIntent();
const DECLARED = '1789166500';

async function freezeLinkConsent(signer: IdentityPort, preimageJson: string) {
  const digest = await sha256Bytes(new TextEncoder().encode(preimageJson));
  if (!digest.ok) throw new Error('digest failed');
  const r = await signer.freezeConsent({
    kind: 'identity_link',
    digest_hex: toHex(digest.value),
    display: { format: IDENTITY_LINK_FORMAT },
    session_id: 'sess-link',
  });
  if (!r.ok) throw new Error(`link consent failed: ${r.error.code}`);
  return r.value;
}

async function makeLink() {
  const oldSigner = await newSigner();
  const nextSigner = await newSigner();
  const preimageJson = identityLinkPreimageJson(oldSigner.publicKey, nextSigner.publicKey, DECLARED);
  const linkConsent = await freezeLinkConsent(nextSigner, preimageJson);
  const link = await buildKeyContinuityLink({
    old_key: oldSigner.publicKey,
    new_key: nextSigner.publicKey,
    declared_at: DECLARED,
    new_key_signer: nextSigner,
    consent_id: linkConsent.consent_id,
  });
  if (!link.ok) throw new Error(`link build failed: ${link.error.code}`);
  const stmt = keyContinuityStatement({
    network_genesis: intent.network_genesis,
    program_id: intent.program_id,
    aux_key: nextSigner.publicKey,
    payload_sha256: link.value.payload_sha256,
    declared_at: DECLARED,
    custody_mode: 'server_custodied',
  });
  const stmtConsent = await freezeStatementConsent(oldSigner, stmt);
  const signed = await oldSigner.signStatement(stmtConsent.consent_id, stmt);
  if (!signed.ok) throw new Error(`stmt sign failed: ${signed.error.code}`);
  return { oldSigner, nextSigner, link: link.value, stmt, signed: signed.value };
}

describe('KEY_CONTINUITY round-trip', () => {
  it('builds a link payload, binds it in the statement, and verifies end-to-end', async () => {
    const { oldSigner, nextSigner, link, stmt, signed } = await makeLink();

    // Payload is canonical sorted-key JSON embedding the countersignature.
    const parsed = parseIdentityLinkPayload(link.payload_json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.old_key).toBe(oldSigner.publicKey);
    expect(parsed.value.new_key).toBe(nextSigner.publicKey);
    expect(canonicalJsonStringify(parsed.value)).toBe(link.payload_json);

    const v = await verifyKeyContinuity({
      statement: stmt,
      signature_base64: signed.signature_base64,
      signer: oldSigner.publicKey,
      payload_json: link.payload_json,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.record_signature_valid).toBe(true);
    expect(v.value.payload_hash_match).toBe(true);
    expect(v.value.payload_canonical).toBe(true);
    expect(v.value.countersignature_valid).toBe(true);
    expect(v.value.old_key).toBe(oldSigner.publicKey);
    expect(v.value.new_key).toBe(nextSigner.publicKey);
    expect(v.value.assessment).toBe('verified_continuity_link');
    // Even a perfect link is a CLAIM, not proof of current control.
    expect(v.value.requires_dispute_check).toBe(true);
    expect(v.value.notes.join(' ')).toContain('compromised old key');

    // Wire round-trip of the statement itself.
    const enc = encodeStatementV1(stmt);
    expect(enc.ok).toBe(true);
  });
});

describe('fraudulent-rotation detection path', () => {
  it('old key signs a link to an attacker key with NO valid countersignature → surfaced as unverified claim', async () => {
    const oldSigner = await newSigner(); // compromised key
    const attacker = await newSigner(); // attacker key named in aux_key
    // Attacker constructs a payload claiming old→attacker but the embedded
    // "countersignature" was made by a DIFFERENT key (never the aux_key holder
    // cooperating — or a forgery). buildKeyContinuityLink correctly refuses to
    // mint this, so the fraudulent payload is assembled by hand.
    const forger = await newSigner();
    const preimageJson = identityLinkPreimageJson(oldSigner.publicKey, attacker.publicKey, DECLARED);
    const forgeConsent = await freezeLinkConsent(forger, preimageJson);
    const forgedSig = await forger.signIdentityLink(
      forgeConsent.consent_id,
      new TextEncoder().encode(preimageJson),
    );
    expect(forgedSig.ok).toBe(true);
    if (!forgedSig.ok) return;
    const fakePayload = canonicalJsonStringify({
      declared_at: DECLARED,
      format: IDENTITY_LINK_FORMAT,
      new_key: attacker.publicKey,
      new_key_signature_base64: forgedSig.value.signature_base64, // forger's sig, not aux_key's
      old_key: oldSigner.publicKey,
    });
    const fakeHash = await sha256Bytes(new TextEncoder().encode(fakePayload));
    if (!fakeHash.ok) throw new Error('digest');
    const fake = { ok: true as const, value: { payload_json: fakePayload, payload_sha256: toHex(fakeHash.value) } };

    // Sanity: the legitimate builder refuses a countersigner that isn't aux_key.
    const forgeConsent2 = await freezeLinkConsent(forger, preimageJson);
    const refused = await buildKeyContinuityLink({
      old_key: oldSigner.publicKey,
      new_key: attacker.publicKey,
      declared_at: DECLARED,
      new_key_signer: forger,
      consent_id: forgeConsent2.consent_id,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('SIGNER_MISMATCH');

    const stmt = keyContinuityStatement({
      network_genesis: intent.network_genesis,
      program_id: intent.program_id,
      aux_key: attacker.publicKey,
      payload_sha256: fake.value.payload_sha256,
      declared_at: DECLARED,
      custody_mode: 'server_custodied',
    });
    const consent = await freezeStatementConsent(oldSigner, stmt);
    const signed = await oldSigner.signStatement(consent.consent_id, stmt);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const v = await verifyKeyContinuity({
      statement: stmt,
      signature_base64: signed.value.signature_base64,
      signer: oldSigner.publicKey,
      payload_json: fake.value.payload_json,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // The record IS authentic (old key signed it) — but the continuity CLAIM
    // is unverified: surfaced loudly, not silently accepted.
    expect(v.value.record_signature_valid).toBe(true);
    expect(v.value.countersignature_valid).toBe(false);
    expect(v.value.assessment).toBe('continuity_claim_unverified');
    expect(v.value.requires_dispute_check).toBe(true);
  });

  it('a fully-formed attacker link still carries the dispute-check caveat', async () => {
    // Worst case: attacker holds BOTH compromised-old and new keys → every
    // cryptographic check passes; the verifier still surfaces it as a claim.
    const oldSigner = await newSigner();
    const attacker = await newSigner();
    const preimageJson = identityLinkPreimageJson(oldSigner.publicKey, attacker.publicKey, DECLARED);
    const linkConsent = await freezeLinkConsent(attacker, preimageJson);
    const link = await buildKeyContinuityLink({
      old_key: oldSigner.publicKey,
      new_key: attacker.publicKey,
      declared_at: DECLARED,
      new_key_signer: attacker,
      consent_id: linkConsent.consent_id,
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const stmt = keyContinuityStatement({
      network_genesis: intent.network_genesis,
      program_id: intent.program_id,
      aux_key: attacker.publicKey,
      payload_sha256: link.value.payload_sha256,
      declared_at: DECLARED,
      custody_mode: 'server_custodied',
    });
    const consent = await freezeStatementConsent(oldSigner, stmt);
    const signed = await oldSigner.signStatement(consent.consent_id, stmt);
    if (!signed.ok) throw new Error('sign');

    const v = await verifyKeyContinuity({
      statement: stmt,
      signature_base64: signed.value.signature_base64,
      signer: oldSigner.publicKey,
      payload_json: link.value.payload_json,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.assessment).toBe('verified_continuity_link');
    expect(v.value.requires_dispute_check).toBe(true);
    expect(v.value.notes.join(' ')).toContain('fraudulent rotation');
  });

  it('missing payload bytes → claim_unverified (record authentic, link unproven)', async () => {
    const { oldSigner, stmt, signed } = await makeLink();
    const v = await verifyKeyContinuity({
      statement: stmt,
      signature_base64: signed.signature_base64,
      signer: oldSigner.publicKey,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.record_signature_valid).toBe(true);
    expect(v.value.assessment).toBe('continuity_claim_unverified');
  });

  it('tampered payload → hash mismatch → claim_unverified', async () => {
    const { oldSigner, link, stmt, signed } = await makeLink();
    const tampered = link.payload_json.replace(DECLARED, '1789166501');
    const v = await verifyKeyContinuity({
      statement: stmt,
      signature_base64: signed.signature_base64,
      signer: oldSigner.publicKey,
      payload_json: tampered,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.payload_hash_match).toBe(false);
    expect(v.value.assessment).toBe('continuity_claim_unverified');
  });

  it('a statement signed by a DIFFERENT key than claimed → invalid_record', async () => {
    const { link, stmt, signed } = await makeLink();
    const impostor = await newSigner();
    const v = await verifyKeyContinuity({
      statement: stmt,
      signature_base64: signed.signature_base64,
      signer: impostor.publicKey,
      payload_json: link.payload_json,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.assessment).toBe('invalid_record');
  });
});

describe('RELEASE_ANCHOR binding', () => {
  it('binds the release manifest digest to the economic leaf subject_ref', async () => {
    const signer = await newSigner();
    const leafRef = altAddress(70);
    // "release manifest" = canonical JSON of a fictional manifest
    const manifestJson = canonicalJsonStringify({
      format: 'example.release-manifest/1',
      leaf: leafRef,
      files: [{ path: 'release/track.flac', sha256: 'e'.repeat(64) }],
    });
    const manifestDigest = await sha256Bytes(new TextEncoder().encode(manifestJson));
    if (!manifestDigest.ok) throw new Error('digest');

    const stmt: StatementV1 = {
      format_version: 1,
      network_genesis: intent.network_genesis,
      program_id: intent.program_id,
      project_address: intent.project_address,
      statement_type: 'RELEASE_ANCHOR',
      subject_ref: leafRef,
      aux_key: null,
      payload_sha256: toHex(manifestDigest.value),
      declared_at: DECLARED,
      custody_mode: 'server_custodied',
    };
    const consent = await freezeStatementConsent(signer, stmt);
    const signed = await signer.signStatement(consent.consent_id, stmt);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const v = await verifyStatementSignature(stmt, signed.value.signature_base64, signer.publicKey, {
      network_genesis: intent.network_genesis,
      program_id: intent.program_id,
      project_address: intent.project_address,
    });
    expect(v.ok).toBe(true);

    // A manifest digest that doesn't match the committed payload breaks verification.
    const otherManifest = await sha256Bytes(new TextEncoder().encode(manifestJson + ' '));
    if (!otherManifest.ok) throw new Error('digest');
    const rebound = { ...stmt, payload_sha256: toHex(otherManifest.value) };
    const bad = await verifyStatementSignature(rebound, signed.value.signature_base64, signer.publicKey);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_SIGNATURE');

    // RELEASE_ANCHOR without subject_ref is rejected by the validator itself.
    const missing = { ...stmt, subject_ref: null };
    expect(parseStatementV1(missing).ok).toBe(false);
  });
});
