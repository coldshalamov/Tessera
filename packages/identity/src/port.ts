import type {
  CustodyMode,
  IntentV1,
  StatementV1,
} from '@tessera/types';
import type { IdentityResult } from './errors.js';

/**
 * IdentityPort — the injected signer boundary (docs/05). The protocol identity
 * is an ordinary Ed25519 keypair; custody differs by implementation. Every
 * signature requires a frozen semantic consent snapshot bound to the exact
 * record digest: there is deliberately NO arbitrary sign-these-bytes endpoint.
 *
 * Honest-label contract: `custody_disclosure` always states who can sign and
 * what that does/does not prove. Export returns raw secret material to the
 * caller only; implementations must never write it to logs, audit records or
 * evidence bundles.
 */

export type ConsentKind = 'intent' | 'statement' | 'identity_link';

/**
 * What the user was shown at approval time. `digest_hex` commits the exact
 * signed bytes; `display` stores the verbatim semantic fields that were
 * rendered (exact parent/artifact/claim/terms per docs/05) so a later audit
 * can prove what was approved, not just that something was signed.
 */
export interface ConsentRequest {
  readonly kind: ConsentKind;
  /** Lowercase-hex SHA-256 of the exact bytes to be signed (64 chars). */
  readonly digest_hex: string;
  /** Semantic fields shown to the user, verbatim (e.g. name/title/claim/terms/parent). */
  readonly display: Record<string, string | number | null>;
  /** Authenticated session/user binding for this approval event. */
  readonly session_id: string;
}

export type ConsentState = 'frozen' | 'consumed' | 'cancelled';

export interface ConsentSnapshot {
  readonly consent_id: string;
  readonly kind: ConsentKind;
  readonly digest_hex: string;
  readonly display: Record<string, string | number | null>;
  readonly session_id: string;
  /** Public key (base58) bound to this consent at freeze time. */
  readonly signer: string;
  readonly custody_mode: CustodyMode;
  readonly custody_disclosure: string;
  /** Signer-local Unix seconds (i64 decimal string); a consent record, not a chain time. */
  readonly frozen_at: string;
  readonly state: ConsentState;
}

/** A signature emitted after a frozen consent. `signer` is base58. */
export interface SignedDigest {
  readonly signer: string;
  /** The exact digest that was signed — always equals the frozen consent digest. */
  readonly digest_hex: string;
  /** 64-byte detached Ed25519 signature over the 32-byte digest, base64. */
  readonly signature_base64: string;
}

/** Audit entry for a produced signature; cancelled consents never appear. */
export interface SignedRecord {
  readonly consent_id: string;
  readonly kind: ConsentKind;
  readonly digest_hex: string;
  readonly signature_base64: string;
  readonly signed_at: string;
}

/**
 * Step-up authentication ticket (docs/05: "step-up authentication for
 * economically consequential signature, recovery change and export"). A local
 * test ticket is a random token bound to a session with a short expiry — real
 * deployments bind this to the actual auth provider.
 */
export interface ReauthTicket {
  readonly token: string;
  readonly session_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

export type ExportFormat = 'bytes' | 'hex' | 'base58';

export interface ExportRequest {
  readonly format: ExportFormat;
  /** Token from reauthenticate(); required — export without recent reauth is refused. */
  readonly reauth_token: string;
  readonly session_id: string;
}

/**
 * Raw secret material returned to the caller in the requested format:
 * 'bytes' → Uint8Array(32) seed; 'hex' → 64 lowercase chars; 'base58' →
 * base58 of the 32-byte seed. This is never logged or embedded in any record.
 */
export interface ExportedSecretKey {
  readonly format: ExportFormat;
  readonly material: Uint8Array | string;
  readonly custody_mode: CustodyMode;
  /** Honest disclosure shown alongside the export. */
  readonly warning: string;
}

export interface IdentityPort {
  /** Base58 Ed25519 public key — the contributor/signer identity. */
  readonly publicKey: string;
  readonly custody_mode: CustodyMode;
  readonly custody_disclosure: string;
  readonly signer_kind: 'local_test' | 'external_provider';

  /** Freeze a semantic consent snapshot. The only way to enable a signature. */
  freezeConsent(request: ConsentRequest): Promise<IdentityResult<ConsentSnapshot>>;
  /** Cancel a frozen consent. Produces NO signature record — ever. */
  cancelConsent(consent_id: string): Promise<IdentityResult<{ cancelled: true }>>;
  /** Read back a consent snapshot (for consent-audit tests). */
  getConsent(consent_id: string): Promise<IdentityResult<ConsentSnapshot>>;

  /**
   * Sign an IntentV1. Re-encodes the record, hashes it, and refuses when the
   * digest differs from the frozen consent (CONSENT_MISMATCH) or when the
   * intent names a different contributor (SIGNER_MISMATCH).
   */
  signIntent(consent_id: string, intent: IntentV1): Promise<IdentityResult<SignedDigest>>;
  /** Sign a StatementV1 under the same frozen-consent rules. */
  signStatement(consent_id: string, statement: StatementV1): Promise<IdentityResult<SignedDigest>>;
  /**
   * Sign an identity-link preimage digest (KEY_CONTINUITY countersignature
   * path). Still requires a frozen 'identity_link' consent — no arbitrary
   * signing endpoint exists on this port.
   */
  signIdentityLink(
    consent_id: string,
    preimageBytes: Uint8Array,
  ): Promise<IdentityResult<SignedDigest>>;

  /** Step-up authentication; required before export or recovery changes. */
  reauthenticate(session_id: string): Promise<IdentityResult<ReauthTicket>>;
  /**
   * Return the raw 32-byte secret seed in the caller-provided format. Requires
   * a valid reauth ticket bound to the session. The material is returned to
   * the caller only — implementations MUST NOT log it or put it in any
   * record/bundle. Providers that cannot export return EXPORT_UNAVAILABLE.
   */
  exportSecretKey(request: ExportRequest): Promise<IdentityResult<ExportedSecretKey>>;

  /** All signatures produced so far (audit). Contains no secret material. */
  signedRecords(): readonly SignedRecord[];
}

/** Honest per-mode custody labels (docs/05 "do not hide the distinction"). */
export const CUSTODY_DISCLOSURES: Record<CustodyMode, string> = {
  user_controlled:
    'user_controlled: the key is held on a device/external wallet under the user\'s control; a session can still be compromised.',
  embedded_provider:
    'embedded_provider: ordinary login unlocks a provider-managed key under explicitly configured recovery/delegation; verify actual signing and export semantics.',
  server_custodied:
    'server_custodied: the application can decrypt/sign using a server-held key and could impersonate the contributor; this is not exclusive-authorship or non-repudiation evidence.',
};

export const EXPORT_WARNING =
  'A copied key can have multiple holders. Export does not prove exclusive control and does not revoke the server/provider\'s existing authority. Never send this key through support channels.';
