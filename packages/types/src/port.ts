import type {
  EvidenceBundleV1,
  IntentV1,
  NodeRecordV1,
  NodeRef,
} from './records.js';
import type { Result } from './result.js';

/**
 * TesseraPort surface required by Morpheus (shared/INTEGRATION_CONTRACT.md).
 * All rights/money integers cross the JSON boundary as base-10 strings;
 * claim_bps is an integer 0..10,000. Every method returns a typed Result —
 * expected-invalid input is an error value, never a thrown exception.
 */

export type PortMode = 'local' | 'devnet' | 'mainnet';

/** Readable error codes from the integration contract, plus documented local
 *  extensions used only by the local simulator (see reports/math-conformance.md). */
export type PortErrorCode =
  // contract codes
  | 'AUTH_REQUIRED'
  | 'CONSENT_EXPIRED'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_NETWORK_MISMATCH'
  | 'TERMS_UNAVAILABLE'
  | 'SIGNER_MISMATCH'
  | 'CLAIM_OUT_OF_RANGE'
  | 'CLAIM_ROUNDS_TO_ZERO'
  | 'BRANCH_CAPACITY_EXHAUSTED'
  | 'ZERO_ISSUED'
  | 'METADATA_HASH_MISMATCH'
  | 'RPC_RATE_LIMITED'
  | 'SPONSOR_BUDGET_EXHAUSTED'
  | 'TRANSACTION_TOO_LARGE'
  | 'ANCHOR_FAILED'
  | 'CONTENT_RESTRICTED'
  | 'UNSUPPORTED_VERSION'
  // local-simulator / validation extensions
  | 'PARENT_PROGRAM_MISMATCH'
  | 'PARENT_PROJECT_MISMATCH'
  | 'PARENT_NOT_FINALIZED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_EXISTS'
  | 'PROJECT_ROOT_EXISTS'
  | 'CONTROLLER_CONSENT_REQUIRED'
  | 'TERMS_MISMATCH'
  | 'NONCE_REUSE_MISMATCH'
  | 'REFERENCE_NOT_FOUND'
  | 'INVALID_SIGNATURE'
  | 'INVALID_INTENT'
  | 'RESIDUAL_OUT_OF_RANGE'
  | 'INVALID_AMOUNT'
  | 'INVALID_WEIGHT'
  | 'INVALID_BENEFICIARY_KEY'
  | 'ISSUED_OUT_OF_RANGE'
  | 'ARITHMETIC_OVERFLOW'
  | 'INTERNAL_INVARIANT'
  | 'DEPTH_OUT_OF_RANGE'
  | 'NOT_FOUND'
  | 'BUNDLE_INVALID'
  | 'CRYPTO_UNAVAILABLE'
  | 'VALIDATION_FAILED';

export interface PortError {
  readonly code: PortErrorCode;
  readonly message: string;
}

export type PortResult<T> = Result<T, PortError>;

export function portErr(code: PortErrorCode, message: string): PortResult<never> {
  return { ok: false, error: { code, message } };
}

/** Exact rational payout: numerator/denominator in raw units, decimal strings. */
export interface ExactRatio {
  numerator_units: string;
  denominator_units: string;
}

export interface EconomicPreview {
  mode: PortMode;
  parent: NodeRef | null;
  claim_bps: number;
  residual_in_units: string;
  effective_units: string;
  residual_out_units: string;
  issued_total_units: string;
  own_payout_numerator_units: string;
  own_payout_denominator_units: string;
  /** Optional non-authoritative display hint; exact ratio above is authority. */
  own_payout_display?: string;
  depth: number;
  notes: string[];
}

export interface ContributionInput {
  project_address: string;
  /** Full parent ref or null for the project root. */
  economic_parent: NodeRef | null;
  contributor: string;
  name: string;
  title: string;
  artifact_sha256: string;
  metadata_sha256?: string | null;
  terms_sha256: string;
  claim_bps: number;
  references?: string[];
  custody_mode: 'user_controlled' | 'embedded_provider' | 'server_custodied';
  /** i64 decimal string; untrusted client-declared time. Defaults to now. */
  declared_at?: string;
  /** 16-byte hex; generated when absent. */
  nonce?: string;
  metadata_schema?: string | null;
  /** REVIEWED projects require the configured controller co-signature. */
  controller_cosigned?: boolean;
}

export interface SigningIntent {
  mode: PortMode;
  intent: IntentV1;
  intent_bytes_base64: string;
  intent_sha256: string;
  preview: EconomicPreview;
  warnings: string[];
}

export interface SignedIntent {
  intent: IntentV1;
  /** Ed25519 detached signature over the 32-byte intent digest, base64. */
  signature_base64: string;
  /** Must equal intent.contributor in v1. */
  signer: string;
}

export type SubmissionStatus =
  | 'awaiting_signature'
  | 'queued'
  | 'submitted'
  | 'confirmed'
  | 'finalized';

export interface Submission {
  id: string;
  status: SubmissionStatus;
  /** 'local' means simulated finality only — never chain finality. */
  finality: 'local' | 'confirmed' | 'finalized';
  mode: PortMode;
  node_ref: NodeRef | null;
  error?: PortError;
  observed_slot?: string;
  observed_unix_time?: string;
}

export interface NodeVerification {
  mode: PortMode;
  signature: 'valid-local' | 'invalid' | 'not-checked';
  economics: 'recomputed-match' | 'mismatch' | 'not-checked';
  /** Local mode never claims chain anchoring. */
  chain_finality: 'none-local-simulation' | 'unverified' | 'finalized';
  notes: string[];
}

export interface VerifiedNode {
  node: NodeRecordV1;
  verification: NodeVerification;
}

export interface PayoutEntry {
  node_address: string;
  beneficiary: string;
  effective_units: string;
  numerator_units: string;
  denominator_units: string;
}

export interface ExactPayoutTable {
  mode: PortMode;
  node_ref: NodeRef;
  issued_total_units: string;
  zero_issued: boolean;
  entries: PayoutEntry[];
}

export interface SettlementAllocation {
  beneficiary: string;
  amount_minor: string;
}

export interface SettlementPreview {
  mode: PortMode;
  node_ref: NodeRef;
  amount_minor: string;
  issued_total_units: string;
  allocations: SettlementAllocation[];
}

export interface VerificationCheck {
  name: string;
  result: 'pass' | 'fail' | 'incomplete';
  detail: string;
}

export interface VerificationReport {
  mode: PortMode;
  status: 'valid-local' | 'invalid' | 'incomplete';
  checks: VerificationCheck[];
}

/** The contract's required port. Local mode is a tested simulator, never a
 *  mainnet claim; mode/finality labels must survive every response. */
export interface TesseraPort {
  readonly mode: PortMode;
  previewAppend(parent: NodeRef | null, claimBps: number): Promise<PortResult<EconomicPreview>>;
  prepareContribution(input: ContributionInput): Promise<PortResult<SigningIntent>>;
  submitSignedContribution(
    intent: SignedIntent,
    idempotencyKey: string,
  ): Promise<PortResult<Submission>>;
  getSubmission(id: string): Promise<PortResult<Submission>>;
  getNode(ref: NodeRef): Promise<PortResult<VerifiedNode>>;
  getPayouts(ref: NodeRef): Promise<PortResult<ExactPayoutTable>>;
  verifyRelease(bundle: EvidenceBundleV1): Promise<PortResult<VerificationReport>>;
  exportBranch(ref: NodeRef): Promise<PortResult<EvidenceBundleV1>>;
}
