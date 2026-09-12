//! Footprint measurement (T03): runs the four CU-measurement scenarios from
//! the packet — publish_root, append_contribution, zero-claim append, and
//! 100%-claim root — against the real compiled SBF binary in LiteSVM, and
//! prints a machine-readable table of compute units, serialized transaction
//! size, and signature counts. Values are quoted verbatim into
//! reports/program-footprint.md.

use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use tessera_testkit::*;

fn measure(
    svm: &mut litesvm::LiteSVM,
    payer: &Keypair,
    extra: &[&Keypair],
    ix: solana_instruction::Instruction,
    label: &str,
) {
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &signers,
        svm.latest_blockhash(),
    );
    let tx_bytes = bincode::serialize(&tx).unwrap();
    let sig_count = tx.signatures.len();
    match svm.send_transaction(tx) {
        Ok(meta) => {
            println!(
                "MEASURE|{label}|cu={}|tx_bytes={}|sigs={}",
                meta.compute_units_consumed,
                tx_bytes.len(),
                sig_count
            );
        }
        Err(e) => panic!("{label}: send failed {:?} logs {:?}", e.err, e.meta.logs),
    }
}

fn boot_world() -> (litesvm::LiteSVM, Keypair, Keypair, solana_pubkey::Pubkey) {
    let (mut svm, payer) = setup_svm();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();
    let (config, _) = config_pda();
    measure(
        &mut svm,
        &payer,
        &[],
        init_deployment_ix(TEST_GENESIS, payer.pubkey(), payer.pubkey()),
        "initialize_deployment",
    );
    let _ = config;
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(1),
        title: "Footprint".into(),
        terms_sha256: TERMS,
        extension_policy: 1,
        controller: None,
    };
    measure(
        &mut svm,
        &payer,
        &[&creator],
        create_project_ix(creator.pubkey(), payer.pubkey(), args),
        "create_project",
    );
    let project = project_pda(&creator.pubkey(), &nonce(1)).0;
    (svm, payer, creator, project)
}

#[test]
fn measure_instruction_footprints() {
    let (mut svm, payer, creator, project) = boot_world();
    let cpk = creator.pubkey();

    // publish_root (claim 1500).
    let intent = make_intent(project, None, cpk, nonce(10), "Root", 1500);
    measure(
        &mut svm,
        &payer,
        &[&creator],
        publish_root_ix(project, cpk, payer.pubkey(), &intent),
        "publish_root",
    );
    let root = node_pda(&project, &cpk, &nonce(10)).0;

    // append_contribution (claim 2000 under the root).
    let intent = make_intent(project, Some(root), cpk, nonce(11), "Child", 2000);
    measure(
        &mut svm,
        &payer,
        &[&creator],
        append_ix(project, root, cpk, None, payer.pubkey(), &intent),
        "append_contribution",
    );

    // append_contribution with claim 0.
    let intent = make_intent(project, Some(root), cpk, nonce(12), "Zero", 0);
    measure(
        &mut svm,
        &payer,
        &[&creator],
        append_ix(project, root, cpk, None, payer.pubkey(), &intent),
        "append_zero_claim",
    );

    // A second project whose root claims 100%.
    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(2),
        title: "Full".into(),
        terms_sha256: TERMS,
        extension_policy: 1,
        controller: None,
    };
    measure(
        &mut svm,
        &payer,
        &[&creator],
        create_project_ix(creator.pubkey(), payer.pubkey(), args),
        "create_project_2",
    );
    let project2 = project_pda(&creator.pubkey(), &nonce(2)).0;
    let intent = make_intent(project2, None, cpk, nonce(13), "FullRoot", 10_000);
    measure(
        &mut svm,
        &payer,
        &[&creator],
        publish_root_ix(project2, cpk, payer.pubkey(), &intent),
        "publish_root_full_claim",
    );

    // Account space constants (allocation bytes, rent basis).
    println!(
        "SPACE|DeploymentConfig={}|ProjectAccount={}|ContributionNode={}|StatementRecord={}",
        tessera::state::DeploymentConfig::SPACE,
        tessera::state::ProjectAccount::SPACE,
        tessera::state::ContributionNode::SPACE,
        tessera::state::StatementRecord::SPACE,
    );
    // Max-size append tx: 8 refs + 64B name + 96B title (worst case envelope).
    svm.expire_blockhash();
    let mut intent = make_intent(project, Some(root), cpk, nonce(14), &"é".repeat(32), 1);
    intent.title = "t".repeat(96);
    intent.references = (0u8..8)
        .map(|i| solana_pubkey::Pubkey::new_from_array([i + 1; 32]))
        .collect();
    measure(
        &mut svm,
        &payer,
        &[&creator],
        append_ix(project, root, cpk, None, payer.pubkey(), &intent),
        "append_max_envelope",
    );
}
