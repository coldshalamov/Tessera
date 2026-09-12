//! IntentV1 wire encoding and digest recomputation per docs/14.
//!
//! The encoding MUST match `packages/types/src/wire.ts` byte-for-byte and is
//! verified against the 348-byte golden fixture
//! (fixtures/intent-v1-signature.json) in this crate's unit tests.
//!
//! Field order (normative):
//!   1 domain "TESSERA:CONTRIBUTION:1" (22 ASCII bytes, no length prefix)
//!   2 format_version u8 = 1
//!   3 network_genesis 32B
//!   4 program_id 32B
//!   5 project_address 32B
//!   6 economic_parent: u8 tag + 32B when present
//!   7 references: u8 count (0..=8) + count x 32B
//!   8 nonce 16B
//!   9 contributor 32B
//!  10 name: u32 LE len + UTF-8 bytes (1..=64)
//!  11 title: u32 LE len + UTF-8 bytes (0..=96)
//!  12 artifact_sha256 32B
//!  13 metadata_sha256: u8 tag + 32B when present
//!  14 terms_sha256 32B
//!  15 claim_bps u16 LE
//!  16 statement_code u8 = 1 (CONTRIBUTE_AND_ACCEPT_TERMS)
//!  17 declared_at i64 LE
//!  18 custody_mode u8

use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

use crate::errors::TesseraError;
use crate::{
    INTENT_DOMAIN, INTENT_FORMAT_VERSION, MAX_NAME_UTF8_BYTES, MAX_REFERENCES,
    MAX_TITLE_UTF8_BYTES, STATEMENT_CODE_CONTRIBUTE_AND_ACCEPT_TERMS,
};

/// The complete semantic IntentV1 fields carried as instruction arguments.
/// `format_version`, `statement_code` and the domain separator are fixed v1
/// constants and are not repeated as arguments.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct IntentV1Fields {
    /// Target network domain (deployment genesis hash).
    pub network_genesis: [u8; 32],
    /// Must equal the executing program id.
    pub program_id: Pubkey,
    /// Must equal the project account address.
    pub project_address: Pubkey,
    /// Economic parent node; None iff publish_root.
    pub economic_parent: Option<Pubkey>,
    /// Non-economic descriptive ancestry refs, 0..=8.
    pub references: Vec<Pubkey>,
    /// 16-byte CSPRNG uniqueness/idempotency nonce (PDA seed).
    pub nonce: [u8; 16],
    /// Must equal the native transaction signer (and beneficiary in v1).
    pub contributor: Pubkey,
    /// 1..=64 UTF-8 bytes.
    pub name: String,
    /// 0..=96 UTF-8 bytes.
    pub title: String,
    pub artifact_sha256: [u8; 32],
    pub metadata_sha256: Option<[u8; 32]>,
    /// Must equal the project's master terms digest.
    pub terms_sha256: [u8; 32],
    /// 0..=10000.
    pub claim_bps: u16,
    /// Untrusted client-declared Unix time.
    pub declared_at: i64,
    /// 1 user, 2 embedded, 3 server.
    pub custody_mode: u8,
}

fn push_opt32(w: &mut Vec<u8>, v: &Option<[u8; 32]>) {
    match v {
        None => w.push(0),
        Some(b) => {
            w.push(1);
            w.extend_from_slice(b);
        }
    }
}

fn push_opt_key(w: &mut Vec<u8>, v: &Option<Pubkey>) {
    match v {
        None => w.push(0),
        Some(k) => {
            w.push(1);
            w.extend_from_slice(k.as_ref());
        }
    }
}

fn push_bounded_string(w: &mut Vec<u8>, s: &str) {
    w.extend_from_slice(&(s.len() as u32).to_le_bytes());
    w.extend_from_slice(s.as_bytes());
}

/// Serialize the intent to its exact signing bytes (docs/14 table).
/// No padding, no trailing bytes. Precondition: semantic bounds already
/// validated by `validate_intent_semantics`.
pub fn encode_intent_v1(intent: &IntentV1Fields) -> Vec<u8> {
    let mut w = Vec::with_capacity(384);
    w.extend_from_slice(INTENT_DOMAIN);
    w.push(INTENT_FORMAT_VERSION);
    w.extend_from_slice(&intent.network_genesis);
    w.extend_from_slice(intent.program_id.as_ref());
    w.extend_from_slice(intent.project_address.as_ref());
    push_opt_key(&mut w, &intent.economic_parent);
    w.push(intent.references.len() as u8);
    for r in &intent.references {
        w.extend_from_slice(r.as_ref());
    }
    w.extend_from_slice(&intent.nonce);
    w.extend_from_slice(intent.contributor.as_ref());
    push_bounded_string(&mut w, &intent.name);
    push_bounded_string(&mut w, &intent.title);
    w.extend_from_slice(&intent.artifact_sha256);
    push_opt32(&mut w, &intent.metadata_sha256);
    w.extend_from_slice(&intent.terms_sha256);
    w.extend_from_slice(&intent.claim_bps.to_le_bytes());
    w.push(STATEMENT_CODE_CONTRIBUTE_AND_ACCEPT_TERMS);
    w.extend_from_slice(&intent.declared_at.to_le_bytes());
    w.push(intent.custody_mode);
    w
}

/// intent_digest = SHA256(IntentV1 bytes). The program recomputes this from
/// the semantic fields; a client never supplies the digest itself.
pub fn intent_digest(intent: &IntentV1Fields) -> [u8; 32] {
    hash(&encode_intent_v1(intent)).to_bytes()
}

/// Field-range validation identical to the SDK-side semantic validators
/// (packages/types/src/records.ts). Borsh deserialization already guarantees
/// well-formed UTF-8 for String fields; byte-length bounds are enforced here.
pub fn validate_intent_semantics(intent: &IntentV1Fields) -> Result<()> {
    require!(
        !intent.name.is_empty() && intent.name.len() <= MAX_NAME_UTF8_BYTES,
        TesseraError::NameOutOfRange
    );
    require!(
        intent.title.len() <= MAX_TITLE_UTF8_BYTES,
        TesseraError::TitleOutOfRange
    );
    require!(
        intent.references.len() <= MAX_REFERENCES,
        TesseraError::ReferencesOutOfRange
    );
    require!(
        (1..=3).contains(&intent.custody_mode),
        TesseraError::InvalidCustodyMode
    );
    require!(
        intent.claim_bps <= crate::MAX_CLAIM_BPS,
        TesseraError::ClaimOutOfRange
    );
    Ok(())
}
