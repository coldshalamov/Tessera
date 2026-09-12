#!/usr/bin/env node
/**
 * Regenerate the committed golden vectors in tests/signatures/vectors/.
 *
 * Runs against the BUILT packages (dist/) so generation itself proves the
 * emitted artifact: run `pnpm -r build` first, then `pnpm gen-vectors`
 * inside tests/signatures.
 *
 * Keys are fresh CSPRNG Ed25519 test keys on every run and are marked
 * fixture_only — private seeds exist in memory only and are never written.
 * The vectors commit public key + signature + wire bytes, which is everything
 * an independent verifier needs.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  base58Encode,
  encodeIntentV1,
  encodeStatementV1,
  sha256Bytes,
} from '@tessera/types';
import {
  LocalTestSigner,
  buildKeyContinuityLink,
  canonicalJsonStringify,
  identityLinkPreimageJson,
  keyContinuityStatement,
} from '@tessera/identity';

const VECTORS_DIR = fileURLToPath(new URL('./vectors/', import.meta.url));

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b) => Buffer.from(b).toString('base64');

async function sha256hex(bytes) {
  const d = await sha256Bytes(bytes);
  if (!d.ok) throw new Error('sha256 unavailable');
  return hex(d.value);
}

async function fictionalAddress(label) {
  return base58Encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label))));
}

const GENESIS = 'FzyYqPYZJDeb2qipvU2FVnaGYmGNfuwWnpWmgpW42imP';
const PROGRAM = '8XSPTHtZLZkYEdhBMWMAyxwHFmzrGDTmBiuMw9HYftcn';
const PROJECT = '2K8CfN8zTE59rgTjqZxeTWxTPXFUgKGoC2uVBzYa2XSq';
const DECLARED = '1789166400';

async function signIntentCase(signer, intent) {
  const enc = encodeIntentV1(intent);
  if (!enc.ok) throw new Error(`encode failed: ${enc.error.code} ${enc.error.message}`);
  const digest_hex = await sha256hex(enc.value);
  const consent = await signer.freezeConsent({
    kind: 'intent',
    digest_hex,
    display: { name: intent.name, claim_bps: intent.claim_bps, terms_sha256: intent.terms_sha256 },
    session_id: 'vector-gen',
  });
  if (!consent.ok) throw new Error(`freeze failed: ${consent.error.code}`);
  const signed = await signer.signIntent(consent.value.consent_id, intent);
  if (!signed.ok) throw new Error(`sign failed: ${signed.error.code}`);
  return { wire: enc.value, digest_hex, signature_base64: signed.value.signature_base64 };
}

async function signStatementCase(signer, statement) {
  const enc = encodeStatementV1(statement);
  if (!enc.ok) throw new Error(`encode failed: ${enc.error.code} ${enc.error.message}`);
  const digest_hex = await sha256hex(enc.value);
  const consent = await signer.freezeConsent({
    kind: 'statement',
    digest_hex,
    display: { statement_type: statement.statement_type, payload_sha256: statement.payload_sha256 },
    session_id: 'vector-gen',
  });
  if (!consent.ok) throw new Error(`freeze failed: ${consent.error.code}`);
  const signed = await signer.signStatement(consent.value.consent_id, statement);
  if (!signed.ok) throw new Error(`sign failed: ${signed.error.code}`);
  return { wire: enc.value, digest_hex, signature_base64: signed.value.signature_base64 };
}

function baseIntent(overrides, contributor) {
  return {
    format_version: 1,
    network_genesis: GENESIS,
    program_id: PROGRAM,
    project_address: PROJECT,
    economic_parent: null,
    references: [],
    nonce: '000102030405060708090a0b0c0d0e0f',
    contributor,
    name: 'Alex',
    title: 'The Lantern Room test seed',
    artifact_sha256: 'fd02088635b4bf27a9779a6aac03cd48258cb128d54f41948f052931f4127c1d',
    metadata_sha256: '12cc1c1f597a4173d43b0f4b553cf588785f15d0ad0e5df3d327cd9064dc0a04',
    terms_sha256: '05a2186a31e57ae3d5139f4771df03df05dd07034d64584d3e9620ecd4f71733',
    claim_bps: 1500,
    statement_code: 'CONTRIBUTE_AND_ACCEPT_TERMS',
    declared_at: DECLARED,
    custody_mode: 'server_custodied',
    ...overrides,
  };
}

async function makeSigner(mode) {
  const r = await LocalTestSigner.create({ custody_mode: mode });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

async function intentCases() {
  const ref1 = await fictionalAddress('tessera vector ref node 01');
  const parent = await fictionalAddress('tessera vector economic parent node');
  const refs8 = [];
  for (let i = 0; i < 8; i++) refs8.push(await fictionalAddress(`tessera vector ref node ${i}`));

  const defs = [
    ['base-root', 'Root intent: metadata present, one reference, server_custodied.', {}],
    ['absent-metadata', 'metadata_sha256 absent (option tag 0).', { metadata_sha256: null }],
    ['empty-title', 'title is the empty string (0 bytes, allowed 0..96).', { title: '' }],
    [
      'max-name-multibyte-bound',
      "name is exactly 64 UTF-8 bytes ending in a 2-byte 'é' (62 ASCII + é).",
      { name: 'x'.repeat(62) + 'é' },
    ],
    [
      'max-title-multibyte-bound',
      "title is exactly 96 UTF-8 bytes (32 × '€', 3 bytes each).",
      { title: '€'.repeat(32) },
    ],
    ['references-empty', 'references count 0.', { references: [] }],
    ['references-eight', 'references count 8 (the maximum).', { references: refs8 }],
    [
      'child-intent-user-custody',
      'economic_parent present (tag 1), custody_mode user_controlled.',
      { economic_parent: parent, custody_mode: 'user_controlled' },
    ],
    ['claim-zero-bps', 'claim_bps at lower bound 0.', { claim_bps: 0 }],
  ];

  const cases = [];
  for (const [id, description, overrides] of defs) {
    const signer = await makeSigner(overrides.custody_mode ?? 'server_custodied');
    const intent = baseIntent(
      { references: [ref1], ...overrides },
      signer.publicKey,
    );
    const { wire, digest_hex, signature_base64 } = await signIntentCase(signer, intent);
    cases.push({
      id,
      description,
      record: intent,
      wire_base64: b64(wire),
      wire_bytes: wire.length,
      digest_sha256: digest_hex,
      public_key_base58: signer.publicKey,
      signature_base64,
    });
  }
  return cases;
}

async function statementCases() {
  const subject = await fictionalAddress('tessera vector subject node');
  const leaf = await fictionalAddress('tessera vector release leaf node');
  const cases = [];

  // APP_DEFINED
  {
    const signer = await makeSigner('server_custodied');
    const payload = await sha256hex(new TextEncoder().encode(canonicalJsonStringify({
      note: 'application-namespaced annotation example', namespace: 'example.app/1',
    })));
    const stmt = {
      format_version: 1,
      network_genesis: GENESIS,
      program_id: PROGRAM,
      project_address: PROJECT,
      statement_type: 'APP_DEFINED',
      subject_ref: subject,
      aux_key: null,
      payload_sha256: payload,
      declared_at: DECLARED,
      custody_mode: 'server_custodied',
    };
    const { wire, digest_hex, signature_base64 } = await signStatementCase(signer, stmt);
    cases.push({
      id: 'app-defined',
      description: 'APP_DEFINED annotation bound to a subject node; payload is a namespaced JSON digest.',
      record: stmt,
      wire_base64: b64(wire),
      wire_bytes: wire.length,
      digest_sha256: digest_hex,
      public_key_base58: signer.publicKey,
      signature_base64,
    });
  }

  // KEY_CONTINUITY — real countersignature path through IdentityPort consents.
  {
    const oldSigner = await makeSigner('server_custodied');
    const newSigner = await makeSigner('server_custodied');
    const preimageJson = identityLinkPreimageJson(oldSigner.publicKey, newSigner.publicKey, DECLARED);
    const preDigest = await sha256hex(new TextEncoder().encode(preimageJson));
    const linkConsent = await newSigner.freezeConsent({
      kind: 'identity_link',
      digest_hex: preDigest,
      display: { format: 'tessera.identity-link/1', old_key: oldSigner.publicKey, new_key: newSigner.publicKey },
      session_id: 'vector-gen',
    });
    if (!linkConsent.ok) throw new Error(linkConsent.error.message);
    const link = await buildKeyContinuityLink({
      old_key: oldSigner.publicKey,
      new_key: newSigner.publicKey,
      declared_at: DECLARED,
      new_key_signer: newSigner,
      consent_id: linkConsent.value.consent_id,
    });
    if (!link.ok) throw new Error(link.error.message);
    const stmt = keyContinuityStatement({
      network_genesis: GENESIS,
      program_id: PROGRAM,
      aux_key: newSigner.publicKey,
      payload_sha256: link.value.payload_sha256,
      declared_at: DECLARED,
      custody_mode: 'server_custodied',
    });
    const { wire, digest_hex, signature_base64 } = await signStatementCase(oldSigner, stmt);
    cases.push({
      id: 'key-continuity',
      description:
        'KEY_CONTINUITY: old key signs; aux_key is the new key; payload_sha256 commits the canonical identity-link JSON embedding the new key\'s countersignature. payload_json is included so verifiers can check the link.',
      record: stmt,
      payload_json: link.value.payload_json,
      wire_base64: b64(wire),
      wire_bytes: wire.length,
      digest_sha256: digest_hex,
      public_key_base58: oldSigner.publicKey,
      signature_base64,
    });
  }

  // RELEASE_ANCHOR — binds manifest digest to the economic leaf.
  {
    const signer = await makeSigner('server_custodied');
    const manifest = canonicalJsonStringify({
      format: 'example.release-manifest/1',
      leaf,
      files: [{ path: 'release/track.flac', sha256: 'ab'.repeat(32) }],
    });
    const payload = await sha256hex(new TextEncoder().encode(manifest));
    const stmt = {
      format_version: 1,
      network_genesis: GENESIS,
      program_id: PROGRAM,
      project_address: PROJECT,
      statement_type: 'RELEASE_ANCHOR',
      subject_ref: leaf,
      aux_key: null,
      payload_sha256: payload,
      declared_at: DECLARED,
      custody_mode: 'server_custodied',
    };
    const { wire, digest_hex, signature_base64 } = await signStatementCase(signer, stmt);
    cases.push({
      id: 'release-anchor',
      description: 'RELEASE_ANCHOR: subject_ref is the release economic leaf; payload_sha256 is the release manifest digest.',
      record: stmt,
      wire_base64: b64(wire),
      wire_bytes: wire.length,
      digest_sha256: digest_hex,
      public_key_base58: signer.publicKey,
      signature_base64,
    });
  }

  // RETRACTION_OR_DISPUTE
  {
    const signer = await makeSigner('server_custodied');
    const payload = await sha256hex(new TextEncoder().encode(canonicalJsonStringify({
      format: 'example.dispute-note/1', reason: 'authorship dispute under review',
    })));
    const stmt = {
      format_version: 1,
      network_genesis: GENESIS,
      program_id: PROGRAM,
      project_address: PROJECT,
      statement_type: 'RETRACTION_OR_DISPUTE',
      subject_ref: subject,
      aux_key: null,
      payload_sha256: payload,
      declared_at: DECLARED,
      custody_mode: 'server_custodied',
    };
    const { wire, digest_hex, signature_base64 } = await signStatementCase(signer, stmt);
    cases.push({
      id: 'retraction-or-dispute',
      description: 'RETRACTION_OR_DISPUTE annotates subject_ref without erasing it.',
      record: stmt,
      wire_base64: b64(wire),
      wire_bytes: wire.length,
      digest_sha256: digest_hex,
      public_key_base58: signer.publicKey,
      signature_base64,
    });
  }

  return cases;
}

const intents = await intentCases();
const statements = await statementCases();

const NOTICE =
  'Fictional network/program/project; no chain account or finalized transaction exists. Generated with fresh fixture_only test keys; private seeds were never written.';

writeFileSync(
  `${VECTORS_DIR}intent-v1-vectors.json`,
  JSON.stringify(
    {
      fixture_only: true,
      notice: NOTICE,
      family: 'IntentV1',
      domain: 'TESSERA:CONTRIBUTION:1',
      generated_by: 'tests/signatures/gen-vectors.mjs',
      cases: intents,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  `${VECTORS_DIR}statement-v1-vectors.json`,
  JSON.stringify(
    {
      fixture_only: true,
      notice: NOTICE,
      family: 'StatementV1',
      domain: 'TESSERA:STATEMENT:1',
      generated_by: 'tests/signatures/gen-vectors.mjs',
      cases: statements,
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${intents.length} intent + ${statements.length} statement vectors to ${VECTORS_DIR}`);
