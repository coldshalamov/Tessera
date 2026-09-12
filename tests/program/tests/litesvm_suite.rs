//! Instruction-level suite executed against the real compiled tessera.so
//! inside LiteSVM (an in-process SVM running the same bytecode a validator
//! runs). Covers the T03 acceptance surface: happy paths plus foreign/
//! malicious accounts, wrong signer/controller, cross-project/network,
//! duplicate/conflicting nonce, string bounds, zero/tiny/100% claims,
//! simultaneous siblings and malformed bytes — each asserted to FAIL with
//! the expected program error.
//!
//! Custom error codes are `6000 + <variant index>` of
//! programs/tessera/src/errors.rs::TesseraError.

use anchor_lang::InstructionData;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use tessera_testkit::*;

// TesseraError variant indices (see errors.rs order).
const NETWORK_MISMATCH: u32 = 0;
const PROGRAM_MISMATCH: u32 = 1;
const PROJECT_MISMATCH: u32 = 2;
const SIGNER_MISMATCH: u32 = 3;
const TERMS_MISMATCH: u32 = 4;
const NAME_OUT_OF_RANGE: u32 = 5;
const TITLE_OUT_OF_RANGE: u32 = 6;
const REFERENCES_OUT_OF_RANGE: u32 = 7;
const INVALID_CUSTODY: u32 = 8;
const CLAIM_OUT_OF_RANGE: u32 = 9;
const BRANCH_CAPACITY_EXHAUSTED: u32 = 11;
const CLAIM_ROUNDS_TO_ZERO: u32 = 12;
const NONCE_REUSE_MISMATCH: u32 = 16;
const PROJECT_CONFLICT: u32 = 17;
const ROOT_MUST_HAVE_NO_PARENT: u32 = 19;
const PROJECT_ROOT_EXISTS: u32 = 20;
const CREATOR_REQUIRED: u32 = 21;
const PARENT_MISMATCH: u32 = 22;
const PARENT_PROJECT_MISMATCH: u32 = 23;
const DEPTH_OUT_OF_RANGE: u32 = 26;
const CONTROLLER_CONSENT_REQUIRED: u32 = 27;
const CONTROLLER_MISMATCH: u32 = 28;
const INVALID_EXTENSION_POLICY: u32 = 29;
const MISSING_CONTROLLER: u32 = 30;
const INVALID_GENESIS: u32 = 31;
const PROJECT_TITLE_OUT_OF_RANGE: u32 = 32;
const PARENT_NOT_CANONICAL_PDA: u32 = 25;

const POLICY_OPEN: u8 = 1;
const POLICY_REVIEWED: u8 = 2;

/// Standard fixture: deployed config + one OPEN project, returns keys.
struct World {
    payer: Keypair,
    creator: Keypair,
    project: Pubkey,
    project_nonce: [u8; 16],
}

fn open_project(svm: &mut litesvm::LiteSVM, payer: &Keypair, creator: &Keypair, pnonce: u8) -> Pubkey {
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(pnonce),
        title: "The Lantern Room".to_string(),
        terms_sha256: TERMS,
        extension_policy: POLICY_OPEN,
        controller: None,
    };
    must_send(
        svm,
        payer,
        &[creator],
        vec![create_project_ix(creator.pubkey(), payer.pubkey(), args)],
        "create_project",
    );
    project_pda(&creator.pubkey(), &nonce(pnonce)).0
}

fn boot(svm: &mut litesvm::LiteSVM, payer: &Keypair, creator: &Keypair) {
    must_send(
        svm,
        payer,
        &[creator],
        vec![init_deployment_ix(TEST_GENESIS, creator.pubkey(), payer.pubkey())],
        "initialize_deployment",
    );
}

fn world() -> (litesvm::LiteSVM, World) {
    let (mut svm, payer) = setup_svm();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();
    boot(&mut svm, &payer, &creator);
    let project = open_project(&mut svm, &payer, &creator, 1);
    (
        svm,
        World {
            payer,
            creator,
            project,
            project_nonce: nonce(1),
        },
    )
}

/// Publish the canonical root A (claim 1500 bps, per docs/01 worked branch).
fn publish_root_a(svm: &mut litesvm::LiteSVM, w: &World) -> Pubkey {
    let creator = w.creator.pubkey();
    let intent = make_intent(w.project, None, creator, nonce(10), "Script", 1500);
    must_send(
        svm,
        &w.payer,
        &[&w.creator],
        vec![publish_root_ix(w.project, creator, w.payer.pubkey(), &intent)],
        "publish_root A",
    );
    node_pda(&w.project, &creator, &nonce(10)).0
}

fn append(
    svm: &mut litesvm::LiteSVM,
    w: &World,
    parent: Pubkey,
    contributor: &Keypair,
    nonce_b: u8,
    name: &str,
    claim: u16,
) -> Pubkey {
    let intent = make_intent(w.project, Some(parent), contributor.pubkey(), nonce(nonce_b), name, claim);
    must_send(
        svm,
        &w.payer,
        &[contributor],
        vec![append_ix(
            w.project,
            parent,
            contributor.pubkey(),
            None,
            w.payer.pubkey(),
            &intent,
        )],
        "append",
    );
    node_pda(&w.project, &contributor.pubkey(), &nonce(nonce_b)).0
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

#[test]
fn happy_project_root_chain_and_siblings() {
    let (mut svm, w) = world();

    // Project account committed correctly.
    let p = project_at(&svm, &w.project);
    assert_eq!(p.state_version, 1);
    assert_eq!(p.economic_rule, 1);
    assert_eq!(p.extension_policy, POLICY_OPEN);
    assert_eq!(p.creator, w.creator.pubkey());
    assert_eq!(p.network_genesis, TEST_GENESIS);
    assert_eq!(p.program_id, tessera::ID);
    assert_eq!(p.total_units, 1_000_000_000_000);
    assert_eq!(p.title, "The Lantern Room");
    assert_eq!(p.terms_sha256, TERMS);
    assert_eq!(p.root_node, None);
    assert!(p.created_slot > 0 || p.created_unix_time >= 0);

    // Root A: 15% of U.
    let a = publish_root_a(&mut svm, &w);
    let a_data_before = account_at(&svm, &a).unwrap().data;
    let na = node_at(&svm, &a);
    assert_eq!(na.depth, 0);
    assert_eq!(na.economic_parent, None);
    assert_eq!(na.residual_in_units, 1_000_000_000_000);
    assert_eq!(na.effective_units, 150_000_000_000);
    assert_eq!(na.residual_out_units, 850_000_000_000);
    assert_eq!(na.issued_total_units, 150_000_000_000);
    assert_eq!(na.own_payout_numerator_units, 150_000_000_000);
    assert_eq!(na.own_payout_denominator_units, 150_000_000_000);
    // On-chain digest == locally recomputed wire digest.
    let intent_a = make_intent(w.project, None, w.creator.pubkey(), nonce(10), "Script", 1500);
    assert_eq!(na.intent_digest, digest_of(&intent_a));
    // Project linkage set.
    assert_eq!(project_at(&svm, &w.project).root_node, Some(a));

    // Child B under A at 20% of A's residual (docs/01 worked branch).
    let contrib_b = Keypair::new();
    svm.airdrop(&contrib_b.pubkey(), 5_000_000_000).unwrap();
    let b = append(&mut svm, &w, a, &contrib_b, 20, "B take", 2000);
    let nb = node_at(&svm, &b);
    assert_eq!(nb.depth, 1);
    assert_eq!(nb.economic_parent, Some(a));
    assert_eq!(nb.residual_in_units, 850_000_000_000);
    assert_eq!(nb.effective_units, 170_000_000_000);
    assert_eq!(nb.residual_out_units, 680_000_000_000);
    assert_eq!(nb.issued_total_units, 320_000_000_000);
    assert_eq!(
        (nb.own_payout_numerator_units, nb.own_payout_denominator_units),
        (170_000_000_000, 320_000_000_000)
    );

    // Sibling ALICE under the same parent at 50% — simultaneous branches.
    let contrib_alice = Keypair::new();
    svm.airdrop(&contrib_alice.pubkey(), 5_000_000_000).unwrap();
    let alice = append(&mut svm, &w, a, &contrib_alice, 21, "Alice take", 5000);
    let nalice = node_at(&svm, &alice);
    assert_eq!(nalice.effective_units, 425_000_000_000);
    assert_eq!(nalice.residual_out_units, 425_000_000_000);
    assert_eq!(nalice.issued_total_units, 575_000_000_000);

    // Parent bytes unchanged after both sibling appends (read-only parent).
    let a_data_after = account_at(&svm, &a).unwrap().data;
    assert_eq!(
        a_data_before, a_data_after,
        "sibling appends must not mutate parent state"
    );
    assert_eq!(a_data_after.len(), tessera::state::ContributionNode::SPACE);

    // Grandchild C under B at 10%: depth 2 chain.
    let c = append(&mut svm, &w, b, &contrib_b, 22, "C sound", 1000);
    let nc = node_at(&svm, &c);
    assert_eq!(nc.depth, 2);
    assert_eq!(nc.effective_units, 68_000_000_000);
    assert_eq!(nc.issued_total_units, 388_000_000_000);
}

#[test]
fn happy_zero_claim_and_full_claim_edges() {
    let (mut svm, w) = world();
    // Root with claim 0: issued 0, payout 0/0.
    let creator = w.creator.pubkey();
    let intent = make_intent(w.project, None, creator, nonce(11), "ZeroRoot", 0);
    must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![publish_root_ix(w.project, creator, w.payer.pubkey(), &intent)],
        "zero-claim root",
    );
    let z = node_at(&svm, &node_pda(&w.project, &creator, &nonce(11)).0);
    assert_eq!(z.effective_units, 0);
    assert_eq!(z.issued_total_units, 0);
    assert_eq!(
        (z.own_payout_numerator_units, z.own_payout_denominator_units),
        (0, 0)
    );

    // Second project with 100% root; only zero-claim children may follow.
    let project2 = open_project(&mut svm, &w.payer, &w.creator, 2);
    let intent_full = make_intent(project2, None, creator, nonce(12), "FullRoot", 10_000);
    must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![publish_root_ix(project2, creator, w.payer.pubkey(), &intent_full)],
        "100% root",
    );
    let root2 = node_pda(&project2, &creator, &nonce(12)).0;
    let r2 = node_at(&svm, &root2);
    assert_eq!(r2.residual_out_units, 0);
    assert_eq!(r2.issued_total_units, 1_000_000_000_000);

    // Positive claim under exhausted residual -> BRANCH_CAPACITY_EXHAUSTED.
    let mut bad = make_intent(project2, Some(root2), creator, nonce(13), "too late", 1);
    bad.terms_sha256 = TERMS;
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(project2, root2, creator, None, w.payer.pubkey(), &bad)],
    );
    expect_error(res, BRANCH_CAPACITY_EXHAUSTED, "claim under exhausted residual");

    // Zero-claim child under exhausted residual is allowed.
    let ok0 = make_intent(project2, Some(root2), creator, nonce(14), "credit", 0);
    must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(project2, root2, creator, None, w.payer.pubkey(), &ok0)],
        "zero-claim child under exhausted residual",
    );
}

#[test]
fn happy_idempotent_replay_same_intent() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();
    let intent = make_intent(w.project, Some(a), creator, nonce(30), "take", 2500);
    let first = must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
        "append",
    );
    let child = node_pda(&w.project, &creator, &nonce(30)).0;
    let before = account_at(&svm, &child).unwrap();
    // Identical retry (same nonce, same semantics): idempotent success.
    // A byte-identical transaction is deduped as AlreadyProcessed before the
    // program runs, so expire the blockhash to give the retry a fresh
    // signature — the program's own init-or-compare path is what executes.
    svm.expire_blockhash();
    let _second = must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
        "idempotent replay",
    );
    let after = account_at(&svm, &child).unwrap();
    assert_eq!(before.data, after.data, "replay must not rewrite the node");
    assert!(first.compute_units_consumed > 0);
}

#[test]
fn happy_references_and_max_strings() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();
    // 8 references (bound) + 64-byte name + 96-byte title.
    let refs: Vec<Pubkey> = (0u8..8).map(|i| Pubkey::new_from_array([i + 1; 32])).collect();
    let mut intent = make_intent(w.project, Some(a), creator, nonce(31), "n", 1);
    intent.references = refs.clone();
    intent.name = "é".repeat(32); // 64 UTF-8 bytes
    intent.title = "t".repeat(96);
    must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
        "max strings + 8 references",
    );
    let node = node_pda(&w.project, &creator, &nonce(31)).0;
    let n = node_at(&svm, &node);
    assert_eq!(n.references.len(), 8);
    assert_eq!(n.references, refs);
    assert_eq!(n.name.len(), 64);
    assert_eq!(n.title.len(), 96);
}

#[test]
fn happy_reviewed_controller_cosign() {
    let (mut svm, payer) = setup_svm();
    let creator = Keypair::new();
    let controller = Keypair::new();
    svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&controller.pubkey(), 5_000_000_000).unwrap();
    boot(&mut svm, &payer, &creator);

    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(9),
        title: "Reviewed".into(),
        terms_sha256: TERMS,
        extension_policy: POLICY_REVIEWED,
        controller: Some(controller.pubkey()),
    };
    must_send(
        &mut svm,
        &payer,
        &[&creator],
        vec![create_project_ix(creator.pubkey(), payer.pubkey(), args)],
        "create REVIEWED project",
    );
    let project = project_pda(&creator.pubkey(), &nonce(9)).0;
    let root_intent = make_intent(project, None, creator.pubkey(), nonce(40), "root", 3000);
    must_send(
        &mut svm,
        &payer,
        &[&creator],
        vec![publish_root_ix(project, creator.pubkey(), payer.pubkey(), &root_intent)],
        "reviewed root",
    );
    let root = node_pda(&project, &creator.pubkey(), &nonce(40)).0;

    let child = Keypair::new();
    svm.airdrop(&child.pubkey(), 5_000_000_000).unwrap();
    let intent = make_intent(project, Some(root), child.pubkey(), nonce(41), "kid", 1000);
    // With the recorded controller co-signing: succeeds.
    must_send(
        &mut svm,
        &payer,
        &[&child, &controller],
        vec![append_ix(
            project,
            root,
            child.pubkey(),
            Some(controller.pubkey()),
            payer.pubkey(),
            &intent,
        )],
        "controller co-signed append",
    );
}

// ---------------------------------------------------------------------------
// Adversarial paths — all must FAIL with the expected error
// ---------------------------------------------------------------------------

#[test]
fn adversarial_wrong_signer() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 5_000_000_000).unwrap();
    // Intent claims contributor = creator, but the signer account is attacker.
    let mut intent = make_intent(w.project, Some(a), w.creator.pubkey(), nonce(50), "x", 1000);
    let ix = append_ix(w.project, a, attacker.pubkey(), None, w.payer.pubkey(), &intent);
    let res = send(&mut svm, &w.payer, &[&attacker], vec![ix]);
    expect_error(res, SIGNER_MISMATCH, "attacker signing for creator intent");

    // And the reverse: intent.contributor = attacker, signer = creator.
    intent.contributor = attacker.pubkey();
    let ix2 = append_ix(w.project, a, w.creator.pubkey(), None, w.payer.pubkey(), &intent);
    let res2 = send(&mut svm, &w.payer, &[&w.creator], vec![ix2]);
    expect_error(res2, SIGNER_MISMATCH, "contributor arg vs signer mismatch");
}

#[test]
fn adversarial_cross_project_parent() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let project2 = open_project(&mut svm, &w.payer, &w.creator, 3);
    let creator = w.creator.pubkey();
    // Parent belongs to project 1; child claims project 2.
    let mut intent = make_intent(project2, Some(a), creator, nonce(51), "x", 1000);
    let ix = append_ix(project2, a, creator, None, w.payer.pubkey(), &intent);
    let res = send(&mut svm, &w.payer, &[&w.creator], vec![ix]);
    expect_error(res, PARENT_PROJECT_MISMATCH, "cross-project parent");

    // Parent arg is a node of project2... but economic_parent points at A.
    // (equally rejected by ParentMismatch once a project2 node exists)
    intent.economic_parent = Some(w.project); // not a node at all
    let ix2 = append_ix(project2, a, creator, None, w.payer.pubkey(), &intent);
    let res2 = send(&mut svm, &w.payer, &[&w.creator], vec![ix2]);
    expect_error(res2, PARENT_MISMATCH, "economic_parent != supplied parent");
}

#[test]
fn adversarial_domain_fields() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();

    // Wrong network genesis.
    let mut intent = make_intent(w.project, Some(a), creator, nonce(52), "x", 1000);
    intent.network_genesis = [0x99; 32];
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
    );
    expect_error(res, NETWORK_MISMATCH, "wrong genesis domain");

    // Wrong program id.
    let mut intent = make_intent(w.project, Some(a), creator, nonce(52), "x", 1000);
    intent.program_id = Pubkey::new_from_array([7; 32]);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
    );
    expect_error(res, PROGRAM_MISMATCH, "wrong program domain");

    // Wrong project address in intent.
    let mut intent = make_intent(w.project, Some(a), creator, nonce(52), "x", 1000);
    intent.project_address = Pubkey::new_from_array([8; 32]);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
    );
    expect_error(res, PROJECT_MISMATCH, "wrong project domain");
}

#[test]
fn adversarial_terms_mismatch() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();
    let mut intent = make_intent(w.project, Some(a), creator, nonce(53), "x", 1000);
    intent.terms_sha256 = [0xde; 32];
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
    );
    expect_error(res, TERMS_MISMATCH, "child terms != project master terms");

    // Same on publish_root.
    let mut rintent = make_intent(w.project, None, creator, nonce(54), "x", 1000);
    rintent.terms_sha256 = [0xde; 32];
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![publish_root_ix(w.project, creator, w.payer.pubkey(), &rintent)],
    );
    expect_error(res, TERMS_MISMATCH, "root terms != project master terms");
}

#[test]
fn adversarial_claim_bounds() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();
    let mut intent = make_intent(w.project, Some(a), creator, nonce(55), "x", 10_001);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
    );
    expect_error(res, CLAIM_OUT_OF_RANGE, "claim > 10000");

    // Positive claim that rounds to zero: inject a tiny-residual parent.
    // (unreachable via honest math, but the program must still reject it)
    let contributor = w.creator.pubkey();
    let mut fake = node_at(&svm, &a);
    fake.residual_out_units = 5_000;
    // Stored (project, contributor, nonce) must re-derive the supplied address,
    // otherwise the canonical-PDA check fires before the economics check.
    fake.nonce = nonce(56);
    let fake_addr = node_pda(&w.project, &contributor, &nonce(56)).0;
    inject_account(&mut svm, fake_addr, serialize_account(&fake), tessera::ID);
    intent.claim_bps = 1;
    intent.nonce = nonce(57);
    intent.economic_parent = Some(fake_addr);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, fake_addr, creator, None, w.payer.pubkey(), &intent)],
    );
    expect_error(res, CLAIM_ROUNDS_TO_ZERO, "claim rounds to zero effective");
}

#[test]
fn adversarial_nonce_replay_conflict() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();
    let intent = make_intent(w.project, Some(a), creator, nonce(60), "orig", 2500);
    must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)],
        "append",
    );
    // Same contributor+nonce (=> same PDA) but different claim -> different digest.
    let mut conflict = make_intent(w.project, Some(a), creator, nonce(60), "orig", 2500);
    conflict.claim_bps = 3000;
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &conflict)],
    );
    expect_error(res, NONCE_REUSE_MISMATCH, "same nonce different digest");

    // Same on the project: same nonce, different title.
    let mut args = tessera::CreateProjectArgs {
        project_nonce: w.project_nonce,
        title: "Different title".into(),
        terms_sha256: TERMS,
        extension_policy: POLICY_OPEN,
        controller: None,
    };
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![create_project_ix(creator, w.payer.pubkey(), args.clone())],
    );
    expect_error(res, PROJECT_CONFLICT, "same project nonce, different params");
    // Identical re-run is idempotent success. Fresh blockhash so the retry
    // is a distinct transaction (see happy_idempotent_replay_same_intent).
    args.title = "The Lantern Room".into();
    svm.expire_blockhash();
    must_send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![create_project_ix(creator, w.payer.pubkey(), args)],
        "idempotent project replay",
    );
}

#[test]
fn adversarial_foreign_and_malformed_parents() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();

    // (1) Lookalike parent: correct discriminator, owned by the SYSTEM program.
    let lookalike = Pubkey::new_unique();
    let real = node_at(&svm, &a);
    let fake_bytes = serialize_account(&real);
    inject_account(&mut svm, lookalike, fake_bytes, solana_system_program_id());
    let intent = make_intent(w.project, Some(lookalike), creator, nonce(70), "x", 1000);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, lookalike, creator, None, w.payer.pubkey(), &intent)],
    );
    // owner != program -> anchor account-resolution error (non-custom code)
    assert!(res.is_err(), "system-owned lookalike parent must fail");

    // (2) Malformed bytes: program-owned account with a bad discriminator.
    let malformed = Pubkey::new_unique();
    inject_account(&mut svm, malformed, vec![0xde; 200], tessera::ID);
    let intent = make_intent(w.project, Some(malformed), creator, nonce(71), "x", 1000);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, malformed, creator, None, w.payer.pubkey(), &intent)],
    );
    assert!(res.is_err(), "malformed parent must fail");

    // (3) Program-owned, well-formed node but at a NON-canonical address
    //     (a grafted record; impossible on a real chain, rejected anyway).
    let noncanonical = Pubkey::new_unique();
    let noncanon_bytes = serialize_account(&node_at(&svm, &a));
    inject_account(&mut svm, noncanonical, noncanon_bytes, tessera::ID);
    let intent = make_intent(w.project, Some(noncanonical), creator, nonce(72), "x", 1000);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, noncanonical, creator, None, w.payer.pubkey(), &intent)],
    );
    // parent.project check passes (copied project field) but PDA check fails.
    expect_error(res, PARENT_NOT_CANONICAL_PDA, "non-canonical parent address");
}

#[test]
fn adversarial_depth_bound() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();
    // Inject a parent already at depth MAX_DEPTH under a canonical PDA.
    let mut deep = node_at(&svm, &a);
    deep.depth = tessera::MAX_DEPTH;
    deep.contributor = creator;
    let deep_nonce = nonce(80);
    let deep_addr = node_pda(&w.project, &creator, &deep_nonce).0;
    deep.nonce = deep_nonce;
    deep.project = w.project;
    inject_account(&mut svm, deep_addr, serialize_account(&deep), tessera::ID);
    let intent = make_intent(w.project, Some(deep_addr), creator, nonce(81), "x", 1000);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![append_ix(w.project, deep_addr, creator, None, w.payer.pubkey(), &intent)],
    );
    expect_error(res, DEPTH_OUT_OF_RANGE, "depth 1025 must be rejected");
}

#[test]
fn adversarial_publish_root_misuse() {
    let (mut svm, w) = world();
    let creator = w.creator.pubkey();

    // publish_root carrying an economic parent.
    let intent = make_intent(w.project, Some(Pubkey::new_unique()), creator, nonce(90), "x", 1000);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![publish_root_ix(w.project, creator, w.payer.pubkey(), &intent)],
    );
    expect_error(res, ROOT_MUST_HAVE_NO_PARENT, "root with parent");

    // publish_root signed by a non-creator.
    let other = Keypair::new();
    svm.airdrop(&other.pubkey(), 5_000_000_000).unwrap();
    let intent = make_intent(w.project, None, other.pubkey(), nonce(91), "x", 1000);
    let res = send(
        &mut svm,
        &w.payer,
        &[&other],
        vec![publish_root_ix(w.project, other.pubkey(), w.payer.pubkey(), &intent)],
    );
    expect_error(res, CREATOR_REQUIRED, "non-creator publish_root");

    // Second root on the same project.
    publish_root_a(&mut svm, &w);
    let intent = make_intent(w.project, None, creator, nonce(92), "second", 1000);
    let res = send(
        &mut svm,
        &w.payer,
        &[&w.creator],
        vec![publish_root_ix(w.project, creator, w.payer.pubkey(), &intent)],
    );
    expect_error(res, PROJECT_ROOT_EXISTS, "second root must fail");
}

#[test]
fn adversarial_string_and_reference_bounds() {
    let (mut svm, w) = world();
    let a = publish_root_a(&mut svm, &w);
    let creator = w.creator.pubkey();

    let mut intent = make_intent(w.project, Some(a), creator, nonce(95), &"n".repeat(65), 1000);
    let res = send(&mut svm, &w.payer, &[&w.creator], vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)]);
    expect_error(res, NAME_OUT_OF_RANGE, "name > 64 bytes");

    intent.name = String::new();
    let res = send(&mut svm, &w.payer, &[&w.creator], vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)]);
    expect_error(res, NAME_OUT_OF_RANGE, "empty name");

    intent.name = "ok".into();
    intent.title = "t".repeat(97);
    let res = send(&mut svm, &w.payer, &[&w.creator], vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)]);
    expect_error(res, TITLE_OUT_OF_RANGE, "title > 96 bytes");

    intent.title = "t".into();
    intent.references = (0u8..9).map(|i| Pubkey::new_from_array([i + 1; 32])).collect();
    let res = send(&mut svm, &w.payer, &[&w.creator], vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)]);
    expect_error(res, REFERENCES_OUT_OF_RANGE, "9 references");

    intent.references = vec![];
    intent.custody_mode = 0;
    let res = send(&mut svm, &w.payer, &[&w.creator], vec![append_ix(w.project, a, creator, None, w.payer.pubkey(), &intent)]);
    expect_error(res, INVALID_CUSTODY, "custody_mode 0");
}

#[test]
fn adversarial_reviewed_without_controller() {
    let (mut svm, payer) = setup_svm();
    let creator = Keypair::new();
    let controller = Keypair::new();
    svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();
    boot(&mut svm, &payer, &creator);

    // REVIEWED without a controller key at creation -> MissingController.
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(8),
        title: "Reviewed".into(),
        terms_sha256: TERMS,
        extension_policy: POLICY_REVIEWED,
        controller: None,
    };
    let res = send(&mut svm, &payer, &[&creator], vec![create_project_ix(creator.pubkey(), payer.pubkey(), args)]);
    expect_error(res, MISSING_CONTROLLER, "REVIEWED without controller");

    // Bogus policy id rejected.
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(8),
        title: "Reviewed".into(),
        terms_sha256: TERMS,
        extension_policy: 7,
        controller: Some(controller.pubkey()),
    };
    let res = send(&mut svm, &payer, &[&creator], vec![create_project_ix(creator.pubkey(), payer.pubkey(), args)]);
    expect_error(res, INVALID_EXTENSION_POLICY, "unknown policy");

    // Proper REVIEWED project.
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(8),
        title: "Reviewed".into(),
        terms_sha256: TERMS,
        extension_policy: POLICY_REVIEWED,
        controller: Some(controller.pubkey()),
    };
    must_send(&mut svm, &payer, &[&creator], vec![create_project_ix(creator.pubkey(), payer.pubkey(), args)], "create reviewed");
    let project = project_pda(&creator.pubkey(), &nonce(8)).0;
    let ri = make_intent(project, None, creator.pubkey(), nonce(96), "root", 3000);
    must_send(&mut svm, &payer, &[&creator], vec![publish_root_ix(project, creator.pubkey(), payer.pubkey(), &ri)], "root");
    let root = node_pda(&project, &creator.pubkey(), &nonce(96)).0;

    let child = Keypair::new();
    svm.airdrop(&child.pubkey(), 5_000_000_000).unwrap();

    // No controller co-signature -> ControllerConsentRequired.
    let intent = make_intent(project, Some(root), child.pubkey(), nonce(97), "kid", 1000);
    let res = send(
        &mut svm,
        &payer,
        &[&child],
        vec![append_ix(project, root, child.pubkey(), None, payer.pubkey(), &intent)],
    );
    expect_error(res, CONTROLLER_CONSENT_REQUIRED, "missing controller sig");

    // Wrong controller -> ControllerMismatch.
    let wrong = Keypair::new();
    svm.airdrop(&wrong.pubkey(), 5_000_000_000).unwrap();
    let res = send(
        &mut svm,
        &payer,
        &[&child, &wrong],
        vec![append_ix(project, root, child.pubkey(), Some(wrong.pubkey()), payer.pubkey(), &intent)],
    );
    expect_error(res, CONTROLLER_MISMATCH, "wrong controller sig");
}

#[test]
fn adversarial_malformed_instruction_data() {
    let (mut svm, w) = world();
    let creator = w.creator.pubkey();
    // Garbage discriminator/payload.
    let ix = Instruction {
        program_id: tessera::ID,
        accounts: vec![],
        data: vec![0xde, 0xad, 0xbe, 0xef, 1, 2, 3],
    };
    let res = send(&mut svm, &w.payer, &[], vec![ix]);
    assert!(res.is_err(), "garbage instruction must fail");

    // Valid discriminator, truncated args.
    let mut data = tessera::instruction::PublishRoot {
        intent: make_intent(w.project, None, creator, nonce(99), "x", 1000),
    }
    .data();
    data.truncate(20);
    let (node, _) = node_pda(&w.project, &creator, &nonce(99));
    let ix = Instruction {
        program_id: tessera::ID,
        accounts: publish_root_metas(w.project, node, creator, w.payer.pubkey()),
        data,
    };
    let res = send(&mut svm, &w.payer, &[&w.creator], vec![ix]);
    assert!(res.is_err(), "truncated args must fail");
}

fn publish_root_metas(project: Pubkey, node: Pubkey, contributor: Pubkey, payer: Pubkey) -> Vec<solana_instruction::AccountMeta> {
    anchor_lang::ToAccountMetas::to_account_metas(
        &tessera::accounts::PublishRoot {
            project,
            node,
            contributor,
            payer,
            system_program: solana_system_program_id(),
        },
        None,
    )
}

#[test]
fn adversarial_uninitialized_project_and_config() {
    let (mut svm, payer) = setup_svm();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();

    // create_project before initialize_deployment: config PDA missing.
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(5),
        title: "x".into(),
        terms_sha256: TERMS,
        extension_policy: POLICY_OPEN,
        controller: None,
    };
    let res = send(&mut svm, &payer, &[&creator], vec![create_project_ix(creator.pubkey(), payer.pubkey(), args)]);
    assert!(res.is_err(), "missing deployment config must fail");

    // Project title > 96 bytes rejected.
    boot(&mut svm, &payer, &creator);
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(5),
        title: "x".repeat(97),
        terms_sha256: TERMS,
        extension_policy: POLICY_OPEN,
        controller: None,
    };
    let res = send(&mut svm, &payer, &[&creator], vec![create_project_ix(creator.pubkey(), payer.pubkey(), args)]);
    expect_error(res, PROJECT_TITLE_OUT_OF_RANGE, "project title > 96");

    // Zero genesis rejected.
    let res = send(
        &mut svm,
        &payer,
        &[&creator],
        vec![init_deployment_ix([0; 32], creator.pubkey(), payer.pubkey())],
    );
    expect_error(res, INVALID_GENESIS, "zero genesis");
}
