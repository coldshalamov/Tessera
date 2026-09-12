import type { Result } from '@tessera/types';

/**
 * Identity-layer error codes. Distinct from the wire validator's
 * ValidationIssue codes and the TesseraPort contract codes: these describe
 * consent/custody/replay failures at the signing boundary. Expected-invalid
 * input is an error value, never a thrown exception.
 */
export type IdentityErrorCode =
  /** freezeConsent called without an authenticated session binding. */
  | 'AUTH_REQUIRED'
  /** Unknown consent_id. */
  | 'CONSENT_NOT_FOUND'
  /** Digest presented for signing differs from the frozen consent digest — an altered claim is refused. */
  | 'CONSENT_MISMATCH'
  /** Consent was cancelled or already consumed; cancellation produces no record. */
  | 'CONSENT_STATE'
  /** Record's contributor/signer does not equal this signer's key. */
  | 'SIGNER_MISMATCH'
  /** Record failed semantic validation or wire encoding. */
  | 'INVALID_RECORD'
  /** Ed25519 verification failed over the record digest. */
  | 'INVALID_SIGNATURE'
  /** Record scope != expected deployment scope (cross-network/program/project replay). */
  | 'NETWORK_MISMATCH'
  | 'PROGRAM_MISMATCH'
  | 'PROJECT_MISMATCH'
  /** Export/step-up attempted without a fresh reauthentication ticket. */
  | 'REAUTH_REQUIRED'
  /** Signer cannot export secret material (external providers may hold it). */
  | 'EXPORT_UNAVAILABLE'
  /** External provider adapter has no credentials configured — production disabled. */
  | 'PROVIDER_NOT_CONFIGURED'
  /** Request object malformed (bad digest hex, empty session, unknown format). */
  | 'INVALID_REQUEST'
  /** Identity-link payload is malformed, unbound or undecodable. */
  | 'IDENTITY_LINK_INVALID'
  /** WebCrypto/noble primitive unavailable in this runtime. */
  | 'CRYPTO_UNAVAILABLE';

export interface IdentityError {
  readonly code: IdentityErrorCode;
  readonly message: string;
}

export type IdentityResult<T> = Result<T, IdentityError>;

export function idErr(code: IdentityErrorCode, message: string): IdentityResult<never> {
  return { ok: false, error: { code, message } };
}
