import * as ed from '@noble/ed25519';
import {
  base58AddressToBytes,
  decodeIntentV1,
  intentDigestBytes,
  parseIntentV1,
  parseStatementV1,
  sha256Bytes,
  statementDigestBytes,
  type IntentV1,
  type StatementV1,
} from '@tessera/types';
import { idErr, type IdentityResult } from './errors.js';

/**
 * Detached-signature verification with explicit deployment scope. The record
 * digest already commits network/program/project, but a verifier must CHECK
 * them against the expected deployment — otherwise a valid signature on a
 * foreign-scoped record replays silently. These helpers make the scope check
 * a required part of verification, not a caller afterthought.
 */

export interface ExpectedScope {
  readonly network_genesis?: string;
  readonly program_id?: string;
  readonly project_address?: string;
}

export interface VerifiedSignature {
  readonly digest_hex: string;
  readonly signer: string;
  readonly valid: true;
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

/** Noble throws on malformed inputs; verification errors mean "not valid". */
async function nobleVerify(
  sig: Uint8Array,
  message: Uint8Array,
  pub: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(sig, message, pub);
  } catch {
    return false;
  }
}

/**
 * Verify a detached Ed25519 signature over SHA-256(IntentV1 bytes).
 * `scope` fields present are checked BEFORE signature verification so a
 * cross-network/program/project replay is refused with a typed error rather
 * than reported as a signature failure.
 */
export async function verifyIntentSignature(
  intent: IntentV1,
  signature_base64: string,
  scope: ExpectedScope = {},
): Promise<IdentityResult<VerifiedSignature>> {
  const parsed = parseIntentV1(intent, 'intent');
  if (!parsed.ok) {
    return idErr('INVALID_RECORD', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
  }
  if (scope.network_genesis !== undefined && intent.network_genesis !== scope.network_genesis) {
    return idErr('NETWORK_MISMATCH', 'intent is scoped to a different network_genesis (cross-network replay)');
  }
  if (scope.program_id !== undefined && intent.program_id !== scope.program_id) {
    return idErr('PROGRAM_MISMATCH', 'intent is scoped to a different program_id (cross-program replay)');
  }
  if (scope.project_address !== undefined && intent.project_address !== scope.project_address) {
    return idErr('PROJECT_MISMATCH', 'intent is scoped to a different project_address (cross-project replay)');
  }
  const digest = await intentDigestBytes(intent);
  if (!digest.ok) return idErr('CRYPTO_UNAVAILABLE', digest.error.message);
  const pub = base58AddressToBytes(intent.contributor);
  const sig = base64ToBytes(signature_base64);
  if (pub === null || sig === null || sig.length !== 64) {
    return idErr('INVALID_REQUEST', 'contributor or signature encoding invalid');
  }
  const validSig = await nobleVerify(sig, digest.value, pub);
  if (!validSig) {
    return idErr('INVALID_SIGNATURE', 'Ed25519 signature does not verify over the intent digest');
  }
  return { ok: true, value: { digest_hex: toHex(digest.value), signer: intent.contributor, valid: true } };
}

/** Same treatment for StatementV1. `project_address` scope applies only when the statement carries one. */
export async function verifyStatementSignature(
  statement: StatementV1,
  signature_base64: string,
  signer: string,
  scope: ExpectedScope = {},
): Promise<IdentityResult<VerifiedSignature>> {
  const parsed = parseStatementV1(statement, 'statement');
  if (!parsed.ok) {
    return idErr('INVALID_RECORD', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
  }
  if (scope.network_genesis !== undefined && statement.network_genesis !== scope.network_genesis) {
    return idErr('NETWORK_MISMATCH', 'statement is scoped to a different network_genesis (cross-network replay)');
  }
  if (scope.program_id !== undefined && statement.program_id !== scope.program_id) {
    return idErr('PROGRAM_MISMATCH', 'statement is scoped to a different program_id (cross-program replay)');
  }
  if (
    scope.project_address !== undefined &&
    statement.project_address !== null &&
    statement.project_address !== scope.project_address
  ) {
    return idErr('PROJECT_MISMATCH', 'statement is scoped to a different project_address (cross-project replay)');
  }
  const digest = await statementDigestBytes(statement);
  if (!digest.ok) return idErr('CRYPTO_UNAVAILABLE', digest.error.message);
  const pub = base58AddressToBytes(signer);
  const sig = base64ToBytes(signature_base64);
  if (pub === null || sig === null || sig.length !== 64) {
    return idErr('INVALID_REQUEST', 'signer or signature encoding invalid');
  }
  const validSig = await nobleVerify(sig, digest.value, pub);
  if (!validSig) {
    return idErr('INVALID_SIGNATURE', 'Ed25519 signature does not verify over the statement digest');
  }
  return { ok: true, value: { digest_hex: toHex(digest.value), signer, valid: true } };
}

/**
 * Tampered-wire check: decode strictness means flipped bytes either fail
 * decoding outright or produce a different record whose digest differs. This
 * helper decodes then verifies — both rejections surface as typed errors.
 */
export async function verifyIntentWire(
  wireBytes: Uint8Array,
  signature_base64: string,
  scope: ExpectedScope = {},
): Promise<IdentityResult<VerifiedSignature>> {
  const decoded = decodeIntentV1(wireBytes);
  if (!decoded.ok) {
    return idErr('INVALID_RECORD', `wire decode failed: ${decoded.error.code} at ${decoded.error.path}`);
  }
  return verifyIntentSignature(decoded.value, signature_base64, scope);
}

/** SHA-256 of arbitrary payload bytes as hex — payload_sha256 helper. */
export async function payloadDigestHex(bytes: Uint8Array): Promise<IdentityResult<string>> {
  const d = await sha256Bytes(bytes);
  if (!d.ok) return idErr('CRYPTO_UNAVAILABLE', d.error.message);
  return { ok: true, value: toHex(d.value) };
}
