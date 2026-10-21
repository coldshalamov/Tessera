/**
 * Pinned on-chain contract constants for the Tessera v1 program.
 *
 * Source of truth: generated/idl/tessera.json (Anchor IDL emitted by the T03
 * build) + generated/vectors/account-layout-v1.json (golden account bytes) +
 * programs/tessera/src/*.rs. These constants are COPIED here on purpose: the
 * published SDK tarball must not depend on repo-relative generated files, and
 * tests/sdk asserts them byte-for-byte against the committed IDL so a silent
 * program/IDL drift fails CI before any deployment trusts it.
 *
 * Compatibility surface checked at connect time (see port.ts):
 *  - program id + `executable` owner sanity
 *  - DeploymentConfig.state_version == 1, config.program_id == this id,
 *    config.network_genesis == the cluster genesis hash we resolved
 *  - IDL spec version '0.1.0' (a program upgrade that changes layouts must
 *    ship a new spec version; this SDK refuses to reinterpret it)
 */

export const TESSERA_PROGRAM_ID = '3fkMf7oJhVkiJF3Q7N6TzbRs16gsDFrJWXHNZcSFvytX';
export const TESSERA_IDL_NAME = 'tessera';
export const TESSERA_IDL_SPEC = '0.1.0';
export const TESSERA_IDL_VERSION = '0.1.0';
export const TESSERA_STATE_VERSION = 1;
export const TESSERA_RULE_RESIDUAL_V1 = 1;

export const EXTENSION_POLICY_OPEN = 1;
export const EXTENSION_POLICY_REVIEWED = 2;

export const NODE_STATE_FINALIZED = 1;

export const MAX_DEPTH = 1024;
export const MAX_TX_BYTES = 1232; // IPv6-MTU transaction packet limit
export const FEE_LAMPORTS_PER_SIGNATURE = 5_000n;

// PDA seed prefixes (docs/14; programs/tessera/src/state.rs)
export const SEED_CONFIG = 'tessera_config';
export const SEED_PROJECT = 'tessera_project';
export const SEED_NODE = 'tessera_node';
export const SEED_STATEMENT = 'tessera_statement';

// Fixed account allocations (rent basis; state.rs SPACE constants and the
// generated account-layout vectors' `allocated_bytes`).
export const DEPLOYMENT_CONFIG_SPACE = 106;
export const PROJECT_ACCOUNT_SPACE = 346;
export const CONTRIBUTION_NODE_SPACE = 759;
export const STATEMENT_RECORD_SPACE = 295;

// Anchor 8-byte account discriminators (sha256("account:<Name>")[..8]),
// verified against generated/idl/tessera.json by tests/sdk.
export const DISC_DEPLOYMENT_CONFIG = Uint8Array.from([13, 112, 57, 81, 43, 26, 156, 18]);
export const DISC_PROJECT_ACCOUNT = Uint8Array.from([179, 110, 82, 178, 208, 35, 171, 116]);
export const DISC_CONTRIBUTION_NODE = Uint8Array.from([159, 34, 58, 239, 138, 119, 25, 35]);
// StatementRecord layout is committed on-chain; the publish_statement
// instruction is intentionally NOT deployed in program v1.
export const DISC_STATEMENT_RECORD = Uint8Array.from([67, 91, 74, 59, 35, 23, 203, 20]);

// Anchor instruction discriminators (sha256("global:<ix_name>")[..8]).
export const IX_APPEND_CONTRIBUTION = Uint8Array.from([19, 74, 24, 219, 22, 237, 233, 7]);
export const IX_CREATE_PROJECT = Uint8Array.from([148, 219, 181, 42, 221, 114, 145, 190]);
export const IX_INITIALIZE_DEPLOYMENT = Uint8Array.from([170, 47, 77, 172, 226, 183, 47, 224]);
export const IX_PUBLISH_ROOT = Uint8Array.from([50, 189, 35, 212, 180, 100, 87, 25]);

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/**
 * On-chain custom error code → contract vocabulary. Codes are Anchor's
 * ERROR_CODE_OFFSET (6000) + the TesseraError variant index; names and
 * ordering verified against generated/idl/tessera.json `errors[]`.
 */
export const ONCHAIN_ERROR_MAP: ReadonlyMap<number, { name: string; code: string }> = new Map(
  [
    [6000, { name: 'NetworkMismatch', code: 'PARENT_NETWORK_MISMATCH' }],
    [6001, { name: 'ProgramMismatch', code: 'PROGRAM_NOT_DEPLOYED' }],
    [6002, { name: 'ProjectMismatch', code: 'PARENT_PROJECT_MISMATCH' }],
    [6003, { name: 'SignerMismatch', code: 'SIGNER_MISMATCH' }],
    [6004, { name: 'TermsMismatch', code: 'TERMS_MISMATCH' }],
    [6005, { name: 'NameOutOfRange', code: 'INVALID_INTENT' }],
    [6006, { name: 'TitleOutOfRange', code: 'INVALID_INTENT' }],
    [6007, { name: 'ReferencesOutOfRange', code: 'INVALID_INTENT' }],
    [6008, { name: 'InvalidCustodyMode', code: 'INVALID_INTENT' }],
    [6009, { name: 'ClaimOutOfRange', code: 'CLAIM_OUT_OF_RANGE' }],
    [6010, { name: 'ResidualOutOfRange', code: 'RESIDUAL_OUT_OF_RANGE' }],
    [6011, { name: 'BranchCapacityExhausted', code: 'BRANCH_CAPACITY_EXHAUSTED' }],
    [6012, { name: 'ClaimRoundsToZero', code: 'CLAIM_ROUNDS_TO_ZERO' }],
    [6013, { name: 'ArithmeticOverflow', code: 'ARITHMETIC_OVERFLOW' }],
    [6014, { name: 'AccountNotFresh', code: 'ANCHOR_FAILED' }],
    [6015, { name: 'InvalidPda', code: 'INTERNAL_INVARIANT' }],
    [6016, { name: 'NonceReuseMismatch', code: 'NONCE_REUSE_MISMATCH' }],
    [6017, { name: 'ProjectConflict', code: 'PROJECT_EXISTS' }],
    [6018, { name: 'DeploymentConflict', code: 'INTERNAL_INVARIANT' }],
    [6019, { name: 'RootMustHaveNoParent', code: 'INVALID_INTENT' }],
    [6020, { name: 'ProjectRootExists', code: 'PROJECT_ROOT_EXISTS' }],
    [6021, { name: 'CreatorRequired', code: 'SIGNER_MISMATCH' }],
    [6022, { name: 'ParentMismatch', code: 'PARENT_PROJECT_MISMATCH' }],
    [6023, { name: 'ParentProjectMismatch', code: 'PARENT_PROJECT_MISMATCH' }],
    [6024, { name: 'ParentNotAppendable', code: 'PARENT_NOT_FINALIZED' }],
    [6025, { name: 'ParentNotCanonicalPda', code: 'PARENT_NOT_FOUND' }],
    [6026, { name: 'DepthOutOfRange', code: 'DEPTH_OUT_OF_RANGE' }],
    [6027, { name: 'ControllerConsentRequired', code: 'CONTROLLER_CONSENT_REQUIRED' }],
    [6028, { name: 'ControllerMismatch', code: 'CONTROLLER_CONSENT_REQUIRED' }],
    [6029, { name: 'InvalidExtensionPolicy', code: 'UNSUPPORTED_VERSION' }],
    [6030, { name: 'MissingController', code: 'CONTROLLER_CONSENT_REQUIRED' }],
    [6031, { name: 'InvalidGenesis', code: 'NETWORK_MISMATCH' }],
    [6032, { name: 'ProjectTitleOutOfRange', code: 'INVALID_INTENT' }],
  ],
);
