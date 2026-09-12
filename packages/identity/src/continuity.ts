import * as ed from '@noble/ed25519';
import {
  base58AddressToBytes,
  sha256Bytes,
  statementDigestBytes,
  parseStatementV1,
  type CustodyMode,
  type StatementV1,
} from '@tessera/types';
import { canonicalJsonStringify } from './canonical.js';
import { idErr, type IdentityResult } from './errors.js';
import type { IdentityPort } from './port.js';

/**
 * KEY_CONTINUITY identity-link payloads (docs/05, docs/14).
 *
 * Wire contract: the StatementV1 signer is the OLD key; `aux_key` carries the
 * NEW public key; `payload_sha256` is SHA-256 of a canonical identity-link
 * JSON which embeds the new key's countersignature, so both sides attest.
 *
 * Payload format (T02 convention, `tessera.identity-link/1`): the NEW key
 * Ed25519-signs the 32-byte SHA-256 of the canonical JSON *preimage*
 *   {"declared_at","format","new_key","old_key"}
 * (sorted-key compact JSON — domain-separated by the format tag). The full
 * committed payload adds `new_key_signature_base64`. A verifier recomputes
 * both hashes and verifies both signatures; a cryptographically complete link
 * is still surfaced as a *claim* requiring a dispute-state check, never as
 * silent proof of current control — a compromised old key can sign a
 * fraudulent rotation (docs/05).
 */

export const IDENTITY_LINK_FORMAT = 'tessera.identity-link/1' as const;

export interface IdentityLinkPreimage {
  readonly format: typeof IDENTITY_LINK_FORMAT;
  readonly old_key: string;
  readonly new_key: string;
  readonly declared_at: string;
}

export interface IdentityLinkPayload extends IdentityLinkPreimage {
  /** New key's Ed25519 signature over SHA-256(canonical preimage), base64. */
  readonly new_key_signature_base64: string;
}

/** Canonical (sorted-key, compact) preimage JSON that the NEW key countersigns. */
export function identityLinkPreimageJson(
  old_key: string,
  new_key: string,
  declared_at: string,
): string {
  const preimage: IdentityLinkPreimage = {
    format: IDENTITY_LINK_FORMAT,
    old_key,
    new_key,
    declared_at,
  };
  return canonicalJsonStringify(preimage);
}

export async function identityLinkPreimageDigest(preimageJson: string) {
  return sha256Bytes(new TextEncoder().encode(preimageJson));
}

export interface BuiltKeyContinuityLink {
  readonly preimage_json: string;
  /** Canonical payload JSON whose SHA-256 is committed as payload_sha256. */
  readonly payload_json: string;
  readonly payload_sha256: string;
  readonly countersignature_base64: string;
}

/**
 * Build a KEY_CONTINUITY link payload. `new_key_signer` must be the IdentityPort
 * for the NEW key and `consent_id` a frozen 'identity_link' consent on it for
 * SHA-256(preimage) — the countersignature cannot bypass consent either.
 */
export async function buildKeyContinuityLink(args: {
  readonly old_key: string;
  readonly new_key: string;
  readonly declared_at: string;
  readonly new_key_signer: IdentityPort;
  readonly consent_id: string;
}): Promise<IdentityResult<BuiltKeyContinuityLink>> {
  if (base58AddressToBytes(args.old_key) === null || base58AddressToBytes(args.new_key) === null) {
    return idErr('IDENTITY_LINK_INVALID', 'old_key/new_key must be base58 32-byte public keys');
  }
  const preimage_json = identityLinkPreimageJson(args.old_key, args.new_key, args.declared_at);
  const signed = await args.new_key_signer.signIdentityLink(
    args.consent_id,
    new TextEncoder().encode(preimage_json),
  );
  if (!signed.ok) return signed;
  if (signed.value.signer !== args.new_key) {
    return idErr('SIGNER_MISMATCH', 'countersignature must come from the new key');
  }
  const payload: IdentityLinkPayload = {
    format: IDENTITY_LINK_FORMAT,
    old_key: args.old_key,
    new_key: args.new_key,
    declared_at: args.declared_at,
    new_key_signature_base64: signed.value.signature_base64,
  };
  const payload_json = canonicalJsonStringify(payload);
  const digest = await sha256Bytes(new TextEncoder().encode(payload_json));
  if (!digest.ok) return idErr('CRYPTO_UNAVAILABLE', digest.error.message);
  return {
    ok: true,
    value: {
      preimage_json,
      payload_json,
      payload_sha256: toHex(digest.value),
      countersignature_base64: signed.value.signature_base64,
    },
  };
}

/**
 * Assemble the KEY_CONTINUITY StatementV1 (identity-scoped: project_address
 * and subject_ref default to null). The OLD key's port signs it via
 * signStatement under a frozen 'statement' consent.
 */
export function keyContinuityStatement(args: {
  readonly network_genesis: string;
  readonly program_id: string;
  readonly aux_key: string; // the NEW public key
  readonly payload_sha256: string;
  readonly declared_at: string;
  readonly custody_mode: CustodyMode;
  readonly project_address?: string | null;
  readonly subject_ref?: string | null;
}): StatementV1 {
  return {
    format_version: 1,
    network_genesis: args.network_genesis,
    program_id: args.program_id,
    project_address: args.project_address ?? null,
    statement_type: 'KEY_CONTINUITY',
    subject_ref: args.subject_ref ?? null,
    aux_key: args.aux_key,
    payload_sha256: args.payload_sha256,
    declared_at: args.declared_at,
    custody_mode: args.custody_mode,
  };
}

/** Strict structural parse of an identity-link payload JSON document. */
export function parseIdentityLinkPayload(payloadJson: string): IdentityResult<IdentityLinkPayload> {
  let v: unknown;
  try {
    v = JSON.parse(payloadJson);
  } catch {
    return idErr('IDENTITY_LINK_INVALID', 'payload is not valid JSON');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return idErr('IDENTITY_LINK_INVALID', 'payload must be a JSON object');
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const want = ['declared_at', 'format', 'new_key', 'new_key_signature_base64', 'old_key'];
  if (keys.length !== want.length || !want.every((k, i) => keys[i] === k)) {
    return idErr('IDENTITY_LINK_INVALID', `payload keys must be exactly ${want.join(', ')}`);
  }
  if (obj['format'] !== IDENTITY_LINK_FORMAT) {
    return idErr('IDENTITY_LINK_INVALID', `format must be ${IDENTITY_LINK_FORMAT}`);
  }
  for (const f of ['old_key', 'new_key'] as const) {
    const k = obj[f];
    if (typeof k !== 'string' || base58AddressToBytes(k) === null) {
      return idErr('IDENTITY_LINK_INVALID', `${f} must be a base58 32-byte public key`);
    }
  }
  if (typeof obj['declared_at'] !== 'string' || !/^-?(0|[1-9][0-9]{0,18})$/.test(obj['declared_at'])) {
    return idErr('IDENTITY_LINK_INVALID', 'declared_at must be an i64 decimal string');
  }
  const sig = obj['new_key_signature_base64'];
  if (typeof sig !== 'string' || base64ToBytes(sig)?.length !== 64) {
    return idErr('IDENTITY_LINK_INVALID', 'new_key_signature_base64 must be a 64-byte base64 signature');
  }
  return { ok: true, value: obj as unknown as IdentityLinkPayload };
}

export type ContinuityAssessment =
  /** Both signatures verify and the payload binds old→new. Still a CLAIM. */
  | 'verified_continuity_link'
  /** Record is authentic but the link is unproven (missing/bad payload or countersignature). */
  | 'continuity_claim_unverified'
  /** The record itself fails (bad signature, wrong type). */
  | 'invalid_record';

export interface ContinuityVerification {
  readonly record_signature_valid: boolean;
  readonly payload_hash_match: boolean | 'not_provided';
  readonly payload_canonical: boolean | 'not_provided';
  readonly countersignature_valid: boolean | 'not_checked';
  readonly old_key: string | null;
  readonly new_key: string | null;
  readonly assessment: ContinuityAssessment;
  /** Always true: continuity records attest a lineage claim, not current control. */
  readonly requires_dispute_check: true;
  readonly notes: string[];
}

const COMPROMISE_NOTE =
  'A cryptographically complete link is a continuity CLAIM, not proof of current control: a compromised old key can sign a fraudulent rotation. Display lineage AND dispute state honestly before treating rotation as identity proof.';

/**
 * Verify a KEY_CONTINUITY record end to end:
 *   1. statement signature must verify under `signer` (the old key);
 *   2. payload bytes (when provided) must hash to payload_sha256;
 *   3. the link must name old_key == signer and new_key == statement.aux_key;
 *   4. the new key's countersignature must verify over the preimage digest.
 * Any gap yields 'continuity_claim_unverified'/'invalid_record' — never a
 * silent accept. A full pass yields 'verified_continuity_link' PLUS
 * requires_dispute_check: the fraud path is surfaced, not swallowed.
 */
export async function verifyKeyContinuity(args: {
  readonly statement: StatementV1;
  readonly signature_base64: string;
  /** Claimed signer = the old public key (base58). */
  readonly signer: string;
  /** The committed payload JSON bytes (utf8), when available to the verifier. */
  readonly payload_json?: string;
}): Promise<IdentityResult<ContinuityVerification>> {
  const notes: string[] = [];
  const base: Omit<ContinuityVerification, 'assessment' | 'notes'> = {
    record_signature_valid: false,
    payload_hash_match: 'not_provided',
    payload_canonical: 'not_provided',
    countersignature_valid: 'not_checked',
    old_key: null,
    new_key: null,
    requires_dispute_check: true,
  };

  const parsed = parseStatementV1(args.statement, 'statement');
  if (!parsed.ok) {
    return idErr('INVALID_RECORD', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
  }
  const st = parsed.value;
  if (st.statement_type !== 'KEY_CONTINUITY') {
    return idErr('INVALID_RECORD', 'statement_type must be KEY_CONTINUITY');
  }
  const signerBytes = base58AddressToBytes(args.signer);
  const sigBytes = base64ToBytes(args.signature_base64);
  if (signerBytes === null || sigBytes === null || sigBytes.length !== 64) {
    return idErr('INVALID_REQUEST', 'signer must be base58 32-byte key; signature must be 64-byte base64');
  }

  const digest = await statementDigestBytes(st);
  if (!digest.ok) return idErr('CRYPTO_UNAVAILABLE', digest.error.message);
  let recordOk = false;
  try {
    recordOk = await ed.verifyAsync(sigBytes, digest.value, signerBytes);
  } catch {
    recordOk = false;
  }
  if (!recordOk) {
    notes.push('statement signature does not verify under the claimed old key');
    return {
      ok: true,
      value: { ...base, assessment: 'invalid_record', notes },
    };
  }

  if (args.payload_json === undefined) {
    notes.push('payload bytes not provided; link cannot be proven, only the record is authentic');
    notes.push(COMPROMISE_NOTE);
    return {
      ok: true,
      value: {
        ...base,
        record_signature_valid: true,
        assessment: 'continuity_claim_unverified',
        notes,
      },
    };
  }

  const payloadHash = await sha256Bytes(new TextEncoder().encode(args.payload_json));
  if (!payloadHash.ok) return idErr('CRYPTO_UNAVAILABLE', payloadHash.error.message);
  const hashMatch = toHex(payloadHash.value) === st.payload_sha256;
  if (!hashMatch) {
    notes.push('payload bytes do not hash to statement.payload_sha256 — record commits different payload');
    notes.push(COMPROMISE_NOTE);
    return {
      ok: true,
      value: {
        ...base,
        record_signature_valid: true,
        payload_hash_match: false,
        assessment: 'continuity_claim_unverified',
        notes,
      },
    };
  }

  const link = parseIdentityLinkPayload(args.payload_json);
  if (!link.ok) {
    notes.push(`payload fails identity-link structure: ${link.error.message}`);
    notes.push(COMPROMISE_NOTE);
    return {
      ok: true,
      value: {
        ...base,
        record_signature_valid: true,
        payload_hash_match: true,
        payload_canonical: false,
        assessment: 'continuity_claim_unverified',
        notes,
      },
    };
  }
  const payloadCanonical = canonicalJsonStringify(link.value) === args.payload_json;

  const bindingOk =
    link.value.old_key === args.signer && link.value.new_key === st.aux_key;
  if (!bindingOk) {
    notes.push('link keys do not match statement signer/aux_key — unbound claim');
  }

  let counterOk = false;
  if (bindingOk) {
    const preimageJson = identityLinkPreimageJson(
      link.value.old_key,
      link.value.new_key,
      link.value.declared_at,
    );
    const preDigest = await identityLinkPreimageDigest(preimageJson);
    if (!preDigest.ok) return idErr('CRYPTO_UNAVAILABLE', preDigest.error.message);
    const counterSig = base64ToBytes(link.value.new_key_signature_base64)!;
    const newKeyBytes = base58AddressToBytes(link.value.new_key)!;
    try {
      counterOk = await ed.verifyAsync(counterSig, preDigest.value, newKeyBytes);
    } catch {
      counterOk = false;
    }
  }
  if (!counterOk) {
    notes.push(
      'new-key countersignature missing/invalid — this is an UNVERIFIED continuity claim (possible fraudulent rotation by a compromised old key)',
    );
  }

  notes.push(COMPROMISE_NOTE);
  return {
    ok: true,
    value: {
      record_signature_valid: true,
      payload_hash_match: true,
      payload_canonical: payloadCanonical,
      countersignature_valid: counterOk,
      old_key: link.value.old_key,
      new_key: link.value.new_key,
      assessment: bindingOk && counterOk ? 'verified_continuity_link' : 'continuity_claim_unverified',
      requires_dispute_check: true,
      notes,
    },
  };
}

function base64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function toHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}
