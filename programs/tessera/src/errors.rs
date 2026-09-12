use anchor_lang::prelude::*;

/// Program error codes. Names deliberately track the typed error codes used by
/// the TypeScript port (`packages/types/src/port.ts`) so SDK surfaces can map
/// on-chain failures onto the same vocabulary.
#[error_code]
pub enum TesseraError {
    #[msg("network_genesis does not match the project's committed deployment domain")]
    NetworkMismatch, // 6000
    #[msg("program_id does not match the executing program")]
    ProgramMismatch,
    #[msg("project_address does not match the supplied project account")]
    ProjectMismatch,
    #[msg("intent contributor must equal the native transaction signer")]
    SignerMismatch,
    #[msg("terms_sha256 must equal the project's immutable master terms digest")]
    TermsMismatch,
    #[msg("name must be 1..=64 UTF-8 bytes")]
    NameOutOfRange,
    #[msg("title must be <= 96 UTF-8 bytes")]
    TitleOutOfRange,
    #[msg("references allows at most 8 entries")]
    ReferencesOutOfRange,
    #[msg("custody_mode must be 1 (user), 2 (embedded) or 3 (server)")]
    InvalidCustodyMode,
    #[msg("claim_bps must be an integer in 0..=10000")]
    ClaimOutOfRange,
    #[msg("residual_in outside 0..=U")]
    ResidualOutOfRange,
    #[msg("positive claim on a fully consumed residual")]
    BranchCapacityExhausted,
    #[msg("positive claim rounds to zero effective units")]
    ClaimRoundsToZero,
    #[msg("checked arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("PDA account is not owned by the system program or is not empty")]
    AccountNotFresh,
    #[msg("PDA seeds do not derive the supplied account address")]
    InvalidPda,
    #[msg("nonce already used with a different intent digest (replay with identical intent is idempotent)")]
    NonceReuseMismatch,
    #[msg("project PDA already exists with different parameters")]
    ProjectConflict,
    #[msg("deployment config PDA already exists with different parameters")]
    DeploymentConflict,
    #[msg("publish_root intents must carry economic_parent = none")]
    RootMustHaveNoParent,
    #[msg("project root node already set")]
    ProjectRootExists,
    #[msg("publish_root signer must be the project creator")]
    CreatorRequired,
    #[msg("intent.economic_parent must equal the supplied parent account")]
    ParentMismatch,
    #[msg("parent node belongs to a different project")]
    ParentProjectMismatch,
    #[msg("parent node is not in an appendable state")]
    ParentNotAppendable,
    #[msg("parent address is not the canonical node PDA for its stored project/contributor/nonce")]
    ParentNotCanonicalPda,
    #[msg("resulting depth would exceed MAX_DEPTH (1024)")]
    DepthOutOfRange,
    #[msg("REVIEWED project requires the recorded controller to co-sign")]
    ControllerConsentRequired,
    #[msg("supplied controller does not match project.controller")]
    ControllerMismatch,
    #[msg("invalid extension policy; expected 1 (OPEN) or 2 (REVIEWED)")]
    InvalidExtensionPolicy,
    #[msg("REVIEWED policy requires a non-null controller key")]
    MissingController,
    #[msg("network_genesis must be a real genesis hash (non-zero)")]
    InvalidGenesis,
    #[msg("project title must be <= 96 UTF-8 bytes")]
    ProjectTitleOutOfRange,
}
