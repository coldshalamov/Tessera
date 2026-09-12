//! Shared helpers for the Tessera program test suite.
//!
//! Tests run the REAL compiled SBF binary (target/deploy/tessera.so) inside
//! LiteSVM — the same bytecode that deploys to a validator — plus an
//! optional live `solana-test-validator` e2e gated on TESSERA_LOCALNET_RPC.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_instruction::error::InstructionError;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use std::path::PathBuf;

pub use tessera;

/// Arbitrary nonzero deployment-domain constant for local testing.
/// The real localnet e2e (localnet_e2e.rs) uses the validator's actual
/// genesis hash instead.
pub const TEST_GENESIS: [u8; 32] = [0x42u8; 32];

pub const TERMS: [u8; 32] = [0x07u8; 32];
pub const ARTIFACT: [u8; 32] = [0xaau8; 32];
pub const METADATA: [u8; 32] = [0xbbu8; 32];

// ---------------------------------------------------------------------------
// Environment / fixture plumbing
// ---------------------------------------------------------------------------

/// Locate the compiled program. Honors TESSERA_SO; falls back to the
/// in-repo target/deploy dir and the WSL-native CARGO_TARGET_DIR.
pub fn so_path() -> PathBuf {
    if let Ok(p) = std::env::var("TESSERA_SO") {
        return PathBuf::from(p);
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let candidates = [
        repo.join("target/deploy/tessera.so"),
        PathBuf::from("/root/tessera-target/deploy/tessera.so"),
    ];
    for c in candidates {
        if c.exists() {
            return c;
        }
    }
    repo.join("target/deploy/tessera.so")
}

pub fn setup_svm() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let so = so_path();
    svm.add_program_from_file(tessera::ID, &so)
        .unwrap_or_else(|e| panic!("cannot load {}: {e} — run `anchor build` first", so.display()));
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
    (svm, payer)
}

pub fn repo_path(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join(rel)
}

// ---------------------------------------------------------------------------
// PDA derivation (docs/14 seeds: project = ["tessera_project", creator, nonce];
// node = ["tessera_node", project, contributor, nonce])
// ---------------------------------------------------------------------------

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[tessera::state::DeploymentConfig::SEED], &tessera::ID)
}

pub fn project_pda(creator: &Pubkey, nonce: &[u8; 16]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            tessera::state::ProjectAccount::SEED,
            creator.as_ref(),
            nonce.as_ref(),
        ],
        &tessera::ID,
    )
}

pub fn node_pda(project: &Pubkey, contributor: &Pubkey, nonce: &[u8; 16]) -> (Pubkey, u8) {
    tessera::state::ContributionNode::find_pda(project, contributor, nonce)
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

fn metas<A: ToAccountMetas>(a: A) -> Vec<solana_instruction::AccountMeta> {
    a.to_account_metas(None)
}

pub fn init_deployment_ix(
    network_genesis: [u8; 32],
    authority: Pubkey,
    payer: Pubkey,
) -> Instruction {
    let (config, _) = config_pda();
    Instruction {
        program_id: tessera::ID,
        accounts: metas(tessera::accounts::InitializeDeployment {
            config,
            authority,
            payer,
            system_program: solana_system_program_id(),
        }),
        data: tessera::instruction::InitializeDeployment { network_genesis }.data(),
    }
}

pub fn create_project_ix(
    creator: Pubkey,
    payer: Pubkey,
    args: tessera::CreateProjectArgs,
) -> Instruction {
    let (config, _) = config_pda();
    let (project, _) = project_pda(&creator, &args.project_nonce);
    Instruction {
        program_id: tessera::ID,
        accounts: metas(tessera::accounts::CreateProject {
            config,
            project,
            creator,
            payer,
            system_program: solana_system_program_id(),
        }),
        data: tessera::instruction::CreateProject { args }.data(),
    }
}

pub fn publish_root_ix(
    project: Pubkey,
    contributor: Pubkey,
    payer: Pubkey,
    intent: &tessera::intent::IntentV1Fields,
) -> Instruction {
    let (node, _) = node_pda(&project, &contributor, &intent.nonce);
    Instruction {
        program_id: tessera::ID,
        accounts: metas(tessera::accounts::PublishRoot {
            project,
            node,
            contributor,
            payer,
            system_program: solana_system_program_id(),
        }),
        data: tessera::instruction::PublishRoot {
            intent: intent.clone(),
        }
        .data(),
    }
}

pub fn append_ix(
    project: Pubkey,
    parent: Pubkey,
    contributor: Pubkey,
    controller: Option<Pubkey>,
    payer: Pubkey,
    intent: &tessera::intent::IntentV1Fields,
) -> Instruction {
    let (node, _) = node_pda(&project, &contributor, &intent.nonce);
    Instruction {
        program_id: tessera::ID,
        accounts: metas(tessera::accounts::AppendContribution {
            project,
            parent,
            node,
            contributor,
            controller,
            payer,
            system_program: solana_system_program_id(),
        }),
        data: tessera::instruction::AppendContribution {
            intent: intent.clone(),
        }
        .data(),
    }
}

/// The system program id as the test-suite solana crates know it.
pub fn solana_system_program_id() -> Pubkey {
    Pubkey::from_str_const("11111111111111111111111111111111")
}

// ---------------------------------------------------------------------------
// Transaction plumbing
// ---------------------------------------------------------------------------

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ixs: Vec<Instruction>,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra_signers);
    let tx = Transaction::new_signed_with_payer(
        &ixs,
        Some(&payer.pubkey()),
        &signers,
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx)
}

/// Extract the program custom error code from a failed transaction.
pub fn custom_error_code(err: &FailedTransactionMetadata) -> Option<u32> {
    match &err.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => Some(*code),
        _ => None,
    }
}

/// Anchor custom error codes start at ERROR_CODE_OFFSET (6000); the enum
/// variant index is the `as u32` discriminant.
pub fn expect_error(
    res: Result<TransactionMetadata, FailedTransactionMetadata>,
    variant: u32,
    what: &str,
) {
    match res {
        Ok(_) => panic!("{what}: transaction unexpectedly succeeded"),
        Err(e) => {
            let code = custom_error_code(&e);
            let expected = anchor_lang::error::ERROR_CODE_OFFSET + variant;
            assert_eq!(
                code,
                Some(expected),
                "{what}: expected custom error {expected}, got {code:?} (logs: {:?})",
                e.meta.logs
            );
        }
    }
}

pub fn must_send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ixs: Vec<Instruction>,
    what: &str,
) -> TransactionMetadata {
    match send(svm, payer, extra_signers, ixs) {
        Ok(m) => m,
        Err(e) => panic!("{what}: send failed: {:?} (logs: {:?})", e.err, e.meta.logs),
    }
}

// ---------------------------------------------------------------------------
// Account reading / injection
// ---------------------------------------------------------------------------

pub fn account_at(svm: &LiteSVM, addr: &Pubkey) -> Option<Account> {
    svm.get_account(addr)
}

pub fn node_at(svm: &LiteSVM, addr: &Pubkey) -> tessera::state::ContributionNode {
    let acc = svm
        .get_account(addr)
        .unwrap_or_else(|| panic!("node {addr} missing"));
    tessera::state::ContributionNode::try_deserialize(&mut &acc.data[..])
        .expect("node deserialize")
}

pub fn project_at(svm: &LiteSVM, addr: &Pubkey) -> tessera::state::ProjectAccount {
    let acc = svm
        .get_account(addr)
        .unwrap_or_else(|| panic!("project {addr} missing"));
    tessera::state::ProjectAccount::try_deserialize(&mut &acc.data[..])
        .expect("project deserialize")
}

/// Serialize an account struct (8-byte discriminator + Borsh body).
pub fn serialize_account<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).expect("serialize");
    buf
}

/// Inject an arbitrary account into the SVM — used to build foreign /
/// malformed / lookalike parents for adversarial tests.
pub fn inject_account(svm: &mut LiteSVM, addr: Pubkey, data: Vec<u8>, owner: Pubkey) {
    let rent = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(
        addr,
        Account {
            lamports: rent.max(1),
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("inject");
}

// ---------------------------------------------------------------------------
// Intent builder
// ---------------------------------------------------------------------------

/// A default valid intent; tests override fields as needed.
pub fn make_intent(
    project: Pubkey,
    parent: Option<Pubkey>,
    contributor: Pubkey,
    nonce: [u8; 16],
    name: &str,
    claim_bps: u16,
) -> tessera::intent::IntentV1Fields {
    tessera::intent::IntentV1Fields {
        network_genesis: TEST_GENESIS,
        program_id: tessera::ID,
        project_address: project,
        economic_parent: parent,
        references: vec![],
        nonce,
        contributor,
        name: name.to_string(),
        title: "test artifact".to_string(),
        artifact_sha256: ARTIFACT,
        metadata_sha256: Some(METADATA),
        terms_sha256: TERMS,
        claim_bps,
        declared_at: 1_789_166_400,
        custody_mode: 3,
    }
}

pub fn nonce(n: u8) -> [u8; 16] {
    [n; 16]
}

/// Recompute the intent digest the same way the program does.
pub fn digest_of(intent: &tessera::intent::IntentV1Fields) -> [u8; 32] {
    tessera::intent::intent_digest(intent)
}
