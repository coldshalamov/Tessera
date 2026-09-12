import * as ed from '@noble/ed25519';
import {
  base58Encode,
  encodeIntentV1,
  encodeStatementV1,
  hexToBytes,
  isLowerHex,
  parseIntentV1,
  parseStatementV1,
  sha256Bytes,
  type CustodyMode,
  type IntentV1,
  type StatementV1,
} from '@tessera/types';
import { idErr, type IdentityResult } from './errors.js';
import {
  CUSTODY_DISCLOSURES,
  EXPORT_WARNING,
  type ConsentKind,
  type ConsentRequest,
  type ConsentSnapshot,
  type ExportedSecretKey,
  type ExportRequest,
  type IdentityPort,
  type ReauthTicket,
  type SignedDigest,
  type SignedRecord,
} from './port.js';

/**
 * LocalTestSigner — in-memory Ed25519 IdentityPort for tests/local mode.
 *
 * Honest labeling (docs/05): `custody_mode` is configured and disclosed; the
 * default demo/pilot mode is 'server_custodied', which always carries the
 * server-impersonation caveat in `custody_disclosure`. Keys are CSPRNG-
 * generated per signer instance (never derived from a shared seed or a
 * database id) or injected explicitly for deterministic fixtures.
 *
 * Consent semantics: sign* calls require a frozen consent whose digest equals
 * the record's digest; a mismatch, a cancelled/consumed consent or an unknown
 * consent id is a typed refusal and emits NO record. `signedRecords()` is the
 * audit trail — a cancelled consent never appears there.
 *
 * Export: requires a fresh reauth ticket bound to the session; returns the raw
 * 32-byte seed in the caller's format. The optional `logger` hook receives
 * lifecycle lines only — secret material is never passed to it.
 */

export interface LocalTestSignerConfig {
  /** Defaults to 'server_custodied' (the documented demo/pilot default). */
  readonly custody_mode?: CustodyMode;
  /** Inject a 32-byte Ed25519 seed (64 lowercase hex); generated when absent. */
  readonly secret_key_hex?: string;
  /** Optional sink for non-secret lifecycle lines; must never receive secret material. */
  readonly logger?: (line: string) => void;
  /** Injectable clock for deterministic tests (Unix seconds, i64 domain). */
  readonly now_unix?: () => bigint;
}

const REAUTH_TTL_SECONDS = 300n;

function randomHex(n: number): string {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

function bytesToBase64(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export class LocalTestSigner implements IdentityPort {
  readonly signer_kind = 'local_test' as const;
  readonly publicKey: string;
  readonly custody_mode: CustodyMode;
  readonly custody_disclosure: string;

  private readonly secretKey: Uint8Array;
  private readonly consents = new Map<string, ConsentSnapshot>();
  private readonly records: SignedRecord[] = [];
  private readonly reauths = new Map<string, { session_id: string; expires_at: bigint }>();
  private readonly log?: (line: string) => void;
  private readonly now: () => bigint;

  private constructor(secretKey: Uint8Array, publicKey: Uint8Array, config: LocalTestSignerConfig) {
    this.secretKey = secretKey;
    this.publicKey = base58Encode(publicKey);
    this.custody_mode = config.custody_mode ?? 'server_custodied';
    this.custody_disclosure = CUSTODY_DISCLOSURES[this.custody_mode];
    this.now = config.now_unix ?? (() => BigInt(Math.floor(Date.now() / 1000)));
    if (config.logger) this.log = config.logger;
  }

  /** Create a signer. Async because public-key derivation uses WebCrypto SHA-512. */
  static async create(config: LocalTestSignerConfig = {}): Promise<IdentityResult<LocalTestSigner>> {
    let secretKey: Uint8Array;
    if (config.secret_key_hex !== undefined) {
      const decoded = hexToBytes(config.secret_key_hex);
      if (!isLowerHex(config.secret_key_hex, 64) || decoded === null) {
        return idErr('INVALID_REQUEST', 'secret_key_hex must be a 32-byte seed as 64 lowercase hex chars');
      }
      secretKey = decoded;
    } else {
      secretKey = ed.utils.randomSecretKey();
    }
    const publicKey = await ed.getPublicKeyAsync(secretKey);
    return { ok: true, value: new LocalTestSigner(secretKey, publicKey, config) };
  }

  async freezeConsent(request: ConsentRequest): Promise<IdentityResult<ConsentSnapshot>> {
    if (typeof request.session_id !== 'string' || request.session_id.length === 0) {
      return idErr('AUTH_REQUIRED', 'consent requires an authenticated session_id binding');
    }
    if (!isLowerHex(request.digest_hex, 64)) {
      return idErr('INVALID_REQUEST', 'digest_hex must be 64 lowercase hex chars (SHA-256)');
    }
    if (request.display === null || typeof request.display !== 'object' || Array.isArray(request.display)) {
      return idErr('INVALID_REQUEST', 'display must be an object of shown field values');
    }
    const snapshot: ConsentSnapshot = {
      consent_id: randomHex(16),
      kind: request.kind,
      digest_hex: request.digest_hex,
      display: { ...request.display },
      session_id: request.session_id,
      signer: this.publicKey,
      custody_mode: this.custody_mode,
      custody_disclosure: this.custody_disclosure,
      frozen_at: this.now().toString(10),
      state: 'frozen',
    };
    this.consents.set(snapshot.consent_id, snapshot);
    this.log?.(`consent frozen id=${snapshot.consent_id} kind=${snapshot.kind} digest=${snapshot.digest_hex}`);
    return { ok: true, value: snapshot };
  }

  async getConsent(consent_id: string): Promise<IdentityResult<ConsentSnapshot>> {
    const c = this.consents.get(consent_id);
    if (!c) return idErr('CONSENT_NOT_FOUND', `unknown consent ${consent_id}`);
    return { ok: true, value: c };
  }

  async cancelConsent(consent_id: string): Promise<IdentityResult<{ cancelled: true }>> {
    const c = this.consents.get(consent_id);
    if (!c) return idErr('CONSENT_NOT_FOUND', `unknown consent ${consent_id}`);
    if (c.state === 'consumed') {
      return idErr('CONSENT_STATE', 'consent already consumed by a signature; nothing to cancel');
    }
    if (c.state !== 'cancelled') {
      this.consents.set(consent_id, { ...c, state: 'cancelled' });
    }
    // Deliberately no SignedRecord is produced — cancellation leaves no trace
    // except the consent's own state transition.
    this.log?.(`consent cancelled id=${consent_id}`);
    return { ok: true, value: { cancelled: true } };
  }

  private takeConsent(
    consent_id: string,
    kind: ConsentKind,
    digest_hex: string,
  ): IdentityResult<ConsentSnapshot> {
    const c = this.consents.get(consent_id);
    if (!c) return idErr('CONSENT_NOT_FOUND', `unknown consent ${consent_id}`);
    if (c.kind !== kind) {
      return idErr('CONSENT_MISMATCH', `consent kind '${c.kind}' cannot sign a '${kind}' digest`);
    }
    if (c.state === 'cancelled') {
      return idErr('CONSENT_STATE', 'consent was cancelled; produce a new consent to sign');
    }
    if (c.state === 'consumed') {
      return idErr('CONSENT_STATE', 'consent already consumed; single-use consent requires a fresh freeze');
    }
    if (c.digest_hex !== digest_hex) {
      // The exact refused case: an altered claim/terms/artifact must not sign.
      return idErr('CONSENT_MISMATCH', 'record digest differs from the frozen consent digest');
    }
    return { ok: true, value: c };
  }

  private async signFrozen(
    consent_id: string,
    kind: ConsentKind,
    digestBytes: Uint8Array,
    digest_hex: string,
  ): Promise<IdentityResult<SignedDigest>> {
    const consent = this.takeConsent(consent_id, kind, digest_hex);
    if (!consent.ok) return consent;
    const signature = await ed.signAsync(digestBytes, this.secretKey);
    this.consents.set(consent_id, { ...consent.value, state: 'consumed' });
    const signature_base64 = bytesToBase64(signature);
    this.records.push({
      consent_id,
      kind,
      digest_hex,
      signature_base64,
      signed_at: this.now().toString(10),
    });
    this.log?.(`signed kind=${kind} digest=${digest_hex} consent=${consent_id}`);
    return {
      ok: true,
      value: { signer: this.publicKey, digest_hex, signature_base64 },
    };
  }

  async signIntent(consent_id: string, intent: IntentV1): Promise<IdentityResult<SignedDigest>> {
    const parsed = parseIntentV1(intent, 'intent');
    if (!parsed.ok) {
      return idErr('INVALID_RECORD', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
    }
    if (intent.contributor !== this.publicKey) {
      return idErr('SIGNER_MISMATCH', 'intent.contributor must equal this signer key; refusing to sign for another identity');
    }
    const encoded = encodeIntentV1(intent);
    if (!encoded.ok) {
      return idErr('INVALID_RECORD', `${encoded.error.code} at ${encoded.error.path}: ${encoded.error.message}`);
    }
    const digest = await sha256Bytes(encoded.value);
    if (!digest.ok) return idErr('CRYPTO_UNAVAILABLE', digest.error.message);
    const digest_hex = toHex(digest.value);
    return this.signFrozen(consent_id, 'intent', digest.value, digest_hex);
  }

  async signStatement(consent_id: string, statement: StatementV1): Promise<IdentityResult<SignedDigest>> {
    const parsed = parseStatementV1(statement, 'statement');
    if (!parsed.ok) {
      return idErr('INVALID_RECORD', `${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message}`);
    }
    const encoded = encodeStatementV1(statement);
    if (!encoded.ok) {
      return idErr('INVALID_RECORD', `${encoded.error.code} at ${encoded.error.path}: ${encoded.error.message}`);
    }
    const digest = await sha256Bytes(encoded.value);
    if (!digest.ok) return idErr('CRYPTO_UNAVAILABLE', digest.error.message);
    return this.signFrozen(consent_id, 'statement', digest.value, toHex(digest.value));
  }

  async signIdentityLink(
    consent_id: string,
    preimageBytes: Uint8Array,
  ): Promise<IdentityResult<SignedDigest>> {
    const digest = await sha256Bytes(preimageBytes);
    if (!digest.ok) return idErr('CRYPTO_UNAVAILABLE', digest.error.message);
    return this.signFrozen(consent_id, 'identity_link', digest.value, toHex(digest.value));
  }

  async reauthenticate(session_id: string): Promise<IdentityResult<ReauthTicket>> {
    if (typeof session_id !== 'string' || session_id.length === 0) {
      return idErr('AUTH_REQUIRED', 'reauthentication requires the authenticated session_id');
    }
    const now = this.now();
    const ticket: ReauthTicket = {
      token: randomHex(16),
      session_id,
      issued_at: now.toString(10),
      expires_at: (now + REAUTH_TTL_SECONDS).toString(10),
    };
    this.reauths.set(ticket.token, { session_id, expires_at: now + REAUTH_TTL_SECONDS });
    this.log?.(`reauth issued for session=${session_id} (not logged: any secret material)`);
    return { ok: true, value: ticket };
  }

  async exportSecretKey(request: ExportRequest): Promise<IdentityResult<ExportedSecretKey>> {
    const grant = this.reauths.get(request.reauth_token);
    if (!grant || grant.session_id !== request.session_id || grant.expires_at < this.now()) {
      return idErr('REAUTH_REQUIRED', 'export requires a fresh reauthentication bound to this session');
    }
    let material: Uint8Array | string;
    switch (request.format) {
      case 'bytes':
        material = new Uint8Array(this.secretKey);
        break;
      case 'hex':
        material = toHex(this.secretKey);
        break;
      case 'base58':
        material = base58Encode(this.secretKey);
        break;
      default:
        return idErr('INVALID_REQUEST', 'format must be bytes | hex | base58');
    }
    // Non-secret audit line only: material never enters logs or records.
    this.log?.(`secret key exported for signer=${this.publicKey} format=${request.format} (material withheld)`);
    return {
      ok: true,
      value: {
        format: request.format,
        material,
        custody_mode: this.custody_mode,
        warning: EXPORT_WARNING,
      },
    };
  }

  signedRecords(): readonly SignedRecord[] {
    return this.records;
  }
}

function toHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}
