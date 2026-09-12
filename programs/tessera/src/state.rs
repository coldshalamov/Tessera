//! On-chain account layouts for Tessera v1.
//!
//! These are the normative account layouts referenced by docs/14
//! ("State account layout"): Anchor `#[account]` types with an 8-byte
//! discriminator, Borsh field encoding, explicit state version. Golden
//! serialization vectors live in `generated/vectors/account-layout-v1.json`
//! (emitted by `tests/program/tests/golden_vectors.rs`).
//!
//! Field order is normative once deployed; never reorder in place.

use anchor_lang::prelude::*;

/// One-time immutable deployment configuration. The program cannot read the
/// cluster genesis hash on-chain (no sysvar exposes it), so each deployment
/// commits its reviewed network-domain value here exactly once
/// (docs/14 "Network binding" — "constant or configuration").
#[account]
pub struct DeploymentConfig {
    /// Layout/state version; always 1 for v1.
    pub state_version: u8,
    /// Target cluster genesis hash — the intent `network_genesis` domain.
    pub network_genesis: [u8; 32],
    /// Program id committed at init; always == the executing program.
    pub program_id: Pubkey,
    /// The authority that ran initialize_deployment. Recorded for
    /// transparency; grants no mutation or admin power in v1.
    pub authority: Pubkey,
    /// Canonical PDA bump for ["tessera_config"].
    pub bump: u8,
}

impl DeploymentConfig {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 1; // 106
    pub const SEED: &'static [u8] = b"tessera_config";
}

/// Immutable project scope. Extension policy and terms are fixed at creation;
/// `root_node` is set exactly once by publish_root.
#[account]
pub struct ProjectAccount {
    /// Layout/state version; always 1.
    pub state_version: u8,
    /// Economic rule id; 1 = "residual-v1".
    pub economic_rule: u8,
    /// Extension policy; 1 = OPEN, 2 = REVIEWED.
    pub extension_policy: u8,
    /// Canonical PDA bump.
    pub bump: u8,
    /// Committed deployment network domain (copied from DeploymentConfig).
    pub network_genesis: [u8; 32],
    /// Always == the executing program id.
    pub program_id: Pubkey,
    /// Project creator; the only key allowed to publish the root.
    pub creator: Pubkey,
    /// REVIEWED co-signer. Inert under OPEN.
    pub controller: Option<Pubkey>,
    /// The unique root node; set once by publish_root, never changed.
    pub root_node: Option<Pubkey>,
    /// 16-byte PDA nonce supplied at creation (also a PDA seed).
    pub project_nonce: [u8; 16],
    /// Bounded project label (<= 96 UTF-8 bytes).
    pub title: String,
    /// Project master contribution-agreement digest; every child intent must
    /// carry this exact value in terms_sha256.
    pub terms_sha256: [u8; 32],
    /// Total capacity U = 1_000_000_000_000.
    pub total_units: u64,
    /// Network-observed creation slot / unix time (not client-asserted).
    pub created_slot: u64,
    pub created_unix_time: i64,
}

impl ProjectAccount {
    // 8 disc + 4 u8 + 32*3 + 33 + 33 + 16 + (4+96) + 32 + 8*3
    pub const SPACE: usize = 8 + 4 + 96 + 33 + 33 + 16 + 100 + 32 + 24; // 346
    pub const SEED: &'static [u8] = b"tessera_project";
}

/// Immutable finalized contribution node. Never mutated, never closed.
/// All seven economic fields are stored per docs/01 ("validated caches").
#[account]
pub struct ContributionNode {
    /// Layout/state version; always 1.
    pub state_version: u8,
    /// Economic rule id; 1 = "residual-v1".
    pub economic_rule: u8,
    /// Node lifecycle state; 1 = FINALIZED (the only on-chain state in v1 —
    /// restricted/disputed are application annotations, never chain state).
    pub node_state: u8,
    /// Canonical PDA bump.
    pub bump: u8,
    /// parent.depth + 1; root depth 0; bound MAX_DEPTH = 1024.
    pub depth: u16,
    /// Claimed basis points of the incoming residual, 0..=10000.
    pub claim_bps: u16,
    /// Disclosed signing context; 1 user, 2 embedded, 3 server.
    pub custody_mode: u8,
    /// Owning project.
    pub project: Pubkey,
    /// Single economic parent; None for the project root.
    pub economic_parent: Option<Pubkey>,
    /// Native signer and beneficiary (v1 beneficiary == contributor).
    pub contributor: Pubkey,
    /// Non-economic descriptive ancestry refs (<= 8).
    pub references: Vec<Pubkey>,
    /// 16-byte contribution nonce (also a PDA seed).
    pub nonce: [u8; 16],
    /// Self-chosen label (1..=64 UTF-8 bytes).
    pub name: String,
    /// Artifact label (<= 96 UTF-8 bytes).
    pub title: String,
    /// SHA-256 of the IntentV1 wire bytes, recomputed on-chain.
    pub intent_digest: [u8; 32],
    pub artifact_sha256: [u8; 32],
    pub metadata_sha256: Option<[u8; 32]>,
    /// Must equal project.terms_sha256.
    pub terms_sha256: [u8; 32],
    /// Untrusted client-declared time.
    pub declared_at: i64,
    /// Network-observed slot / unix time.
    pub observed_slot: u64,
    pub observed_unix_time: i64,
    // ---- residual-v1 economic caches (program-derived, docs/01) ----
    pub residual_in_units: u64,
    pub effective_units: u64,
    pub residual_out_units: u64,
    pub issued_total_units: u64,
    pub own_payout_numerator_units: u64,
    pub own_payout_denominator_units: u64,
}

impl ContributionNode {
    // 8 disc + 5 u8 + 2 u16 + 32*2 + 33 + (4+8*32) + 16 + (4+64) + (4+96)
    //   + 32+32+33+32 + 8*3 + 8*6
    pub const SPACE: usize = 8 + 5 + 4 + 64 + 33 + 260 + 16 + 68 + 100 + 129 + 24 + 48; // 759
    pub const SEED: &'static [u8] = b"tessera_node";

    pub const STATE_FINALIZED: u8 = 1;

    /// Seeds for the canonical node PDA (docs/14): tessera_node, project,
    /// contributor, 16-byte nonce.
    pub fn seeds<'a>(
        project: &'a Pubkey,
        contributor: &'a Pubkey,
        nonce: &'a [u8; 16],
    ) -> [&'a [u8]; 4] {
        [Self::SEED, project.as_ref(), contributor.as_ref(), nonce.as_ref()]
    }

    pub fn find_pda(project: &Pubkey, contributor: &Pubkey, nonce: &[u8; 16]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&Self::seeds(project, contributor, nonce), &crate::ID)
    }
}

/// Append-only signed annotation record (TESSERA:STATEMENT:1 family).
///
/// The `publish_statement` instruction ships in a later packet; this layout
/// is committed now because the account layout is part of the wire contract
/// and must appear in the golden vectors (packet T03). Statements never
/// mutate node economics. Proposed PDA seeds: ["tessera_statement", author,
/// statement_digest] — the digest makes every statement PDA unique while
/// keeping lookup deterministic.
#[account]
pub struct StatementRecord {
    /// Layout/state version; always 1.
    pub state_version: u8,
    /// 1 APP_DEFINED, 2 KEY_CONTINUITY, 3 RELEASE_ANCHOR, 4 RETRACTION_OR_DISPUTE.
    pub statement_type: u8,
    /// Disclosed signing context; 1 user, 2 embedded, 3 server.
    pub custody_mode: u8,
    /// Canonical PDA bump.
    pub bump: u8,
    /// Deployment network domain.
    pub network_genesis: [u8; 32],
    /// Always == the executing program id.
    pub program_id: Pubkey,
    /// Absent for identity-scoped statements (e.g. KEY_CONTINUITY).
    pub project: Option<Pubkey>,
    /// Statement author == native transaction signer.
    pub author: Pubkey,
    /// Node being annotated/finalized (RELEASE_ANCHOR: the economic leaf).
    pub subject_ref: Option<Pubkey>,
    /// KEY_CONTINUITY: the new public key.
    pub aux_key: Option<Pubkey>,
    /// Digest of the referenced payload bytes.
    pub payload_sha256: [u8; 32],
    /// SHA-256 of the StatementV1 wire bytes.
    pub statement_digest: [u8; 32],
    /// Untrusted client-declared time.
    pub declared_at: i64,
    /// Network-observed slot / unix time.
    pub observed_slot: u64,
    pub observed_unix_time: i64,
}

impl StatementRecord {
    // 8 disc + 4 u8 + 32*2 + 33 + 32 + 33 + 33 + 32 + 32 + 8*3
    pub const SPACE: usize = 8 + 4 + 64 + 33 + 32 + 33 + 33 + 32 + 32 + 24; // 295
    pub const SEED: &'static [u8] = b"tessera_statement";
}
