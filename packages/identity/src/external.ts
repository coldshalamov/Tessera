import type { IntentV1, StatementV1 } from '@tessera/types';
import { idErr, type IdentityResult } from './errors.js';
import {
  CUSTODY_DISCLOSURES,
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
 * ExternalSigner — the boundary a managed embedded provider (Privy, Crossmint,
 * …) implements behind. Keeping this interface separate from IdentityPort
 * forces provider-specific facts (export capability, MAU metering, recovery
 * delegation) to be declared up front instead of assumed.
 *
 * Provider facts must come from verified documentation/prototype — see
 * reports/identity-spike.md. No provider is integrated yet; production signing
 * through a managed provider stays disabled until the founder completes the
 * account/credential/approval gate recorded there.
 */
export interface ExternalSigner extends IdentityPort {
  readonly signer_kind: 'external_provider';
  /** Provider identifier, e.g. 'privy' | 'crossmint'. */
  readonly provider: string;
  capabilities(): ProviderCapabilities;
}

export interface ProviderCapabilities {
  /** Whether raw secret-key export is even possible through this provider. */
  readonly can_export_secret_key: boolean | 'provider_dependent';
  /** Whether the provider meters by monthly active users (pricing cliff). */
  readonly mau_metered: boolean;
  /** Whether export/recovery requires provider-side step-up auth. */
  readonly requires_stepup_for_export: boolean;
  /** Provider-specific recovery model in one line, from verified docs. */
  readonly recovery_model: string;
  readonly notes: string[];
}

/** The exact founder action recorded before any provider sign path is enabled. */
export const PROVIDER_GATE_NOTE =
  'Provider not configured. Founder action required before production use: create the provider account, register the application, obtain app credentials, review/approve MAU pricing and recovery/export semantics (see reports/identity-spike.md), then supply credentials via environment — never committed to the repo.';

/**
 * Boundary stub for a future provider adapter. Every operation returns
 * PROVIDER_NOT_CONFIGURED so production mode cannot silently pass through a
 * half-integrated path; signedRecords() stays empty by construction.
 */
export class UnconfiguredProviderSigner implements ExternalSigner {
  readonly signer_kind = 'external_provider' as const;
  readonly custody_mode = 'embedded_provider' as const;
  readonly custody_disclosure = CUSTODY_DISCLOSURES.embedded_provider;
  readonly publicKey: string;

  constructor(readonly provider: string, publicKeyBase58 = '11111111111111111111111111111111') {
    this.publicKey = publicKeyBase58;
  }

  capabilities(): ProviderCapabilities {
    return {
      can_export_secret_key: 'provider_dependent',
      mau_metered: true,
      requires_stepup_for_export: true,
      recovery_model: 'unverified — provider recovery semantics are an approval gate, not an assumption',
      notes: [PROVIDER_GATE_NOTE],
    };
  }

  private unconfigured<T>(): IdentityResult<T> {
    return idErr('PROVIDER_NOT_CONFIGURED', `${this.provider}: ${PROVIDER_GATE_NOTE}`);
  }

  freezeConsent(_request: ConsentRequest): Promise<IdentityResult<ConsentSnapshot>> {
    return Promise.resolve(this.unconfigured());
  }
  cancelConsent(_consent_id: string): Promise<IdentityResult<{ cancelled: true }>> {
    return Promise.resolve(this.unconfigured());
  }
  getConsent(_consent_id: string): Promise<IdentityResult<ConsentSnapshot>> {
    return Promise.resolve(this.unconfigured());
  }
  signIntent(_consent_id: string, _intent: IntentV1): Promise<IdentityResult<SignedDigest>> {
    return Promise.resolve(this.unconfigured());
  }
  signStatement(_consent_id: string, _statement: StatementV1): Promise<IdentityResult<SignedDigest>> {
    return Promise.resolve(this.unconfigured());
  }
  signIdentityLink(_consent_id: string, _preimageBytes: Uint8Array): Promise<IdentityResult<SignedDigest>> {
    return Promise.resolve(this.unconfigured());
  }
  reauthenticate(_session_id: string): Promise<IdentityResult<ReauthTicket>> {
    return Promise.resolve(this.unconfigured());
  }
  exportSecretKey(_request: ExportRequest): Promise<IdentityResult<ExportedSecretKey>> {
    return Promise.resolve(this.unconfigured());
  }
  signedRecords(): readonly SignedRecord[] {
    return [];
  }
}
