//! Live solana-test-validator end-to-end (T03). Runs ONLY when
//! TESSERA_LOCALNET_RPC is set (e.g. http://127.0.0.1:8899) and the program
//! has been deployed under tessera::ID — see reports/program-footprint.md
//! for the exact validator/deploy commands.
//!
//! Uses the validator's REAL genesis hash as the deployment domain, then
//! exercises initialize_deployment -> create_project -> publish_root ->
//! append_contribution over actual JSON-RPC, and measures rent + compute.

use solana_keypair::read_keypair_file;
use solana_keypair::Keypair;
use solana_rpc_client::rpc_client::RpcClient;
use solana_signer::Signer;
use solana_transaction::Transaction;
use tessera_testkit::*;

fn payer() -> Keypair {
    let path = std::env::var("TESSERA_PAYER")
        .unwrap_or_else(|_| "/root/.config/solana/id.json".to_string());
    read_keypair_file(&path).unwrap_or_else(|_| panic!("cannot read payer keypair {path}"))
}

fn send_confirm(
    rpc: &RpcClient,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: Vec<solana_instruction::Instruction>,
    what: &str,
) {
    let bh = rpc.get_latest_blockhash().unwrap();
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend_from_slice(signers);
    let tx = Transaction::new_signed_with_payer(&ixs, Some(&payer.pubkey()), &all, bh);
    rpc.send_and_confirm_transaction(&tx)
        .unwrap_or_else(|e| panic!("{what}: {e}"));
}

#[test]
fn live_localnet_end_to_end() {
    let Ok(url) = std::env::var("TESSERA_LOCALNET_RPC") else {
        eprintln!("TESSERA_LOCALNET_RPC unset — skipping live validator e2e");
        return;
    };
    let rpc = RpcClient::new(url);
    let payer = payer();
    let genesis = rpc.get_genesis_hash().unwrap().to_bytes();
    println!("localnet genesis: {}", rpc.get_genesis_hash().unwrap());

    // Fund payer if empty.
    if rpc.get_balance(&payer.pubkey()).unwrap_or(0) < 2_000_000_000 {
        rpc.request_airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    // Rent quotes for the account footprints (live getMinimumBalance...).
    for (name, size) in [
        ("DeploymentConfig", tessera::state::DeploymentConfig::SPACE),
        ("ProjectAccount", tessera::state::ProjectAccount::SPACE),
        ("ContributionNode", tessera::state::ContributionNode::SPACE),
        ("StatementRecord", tessera::state::StatementRecord::SPACE),
    ] {
        let lamports = rpc.get_minimum_balance_for_rent_exemption(size).unwrap();
        println!("rent-exempt {name} ({size} B): {lamports} lamports");
    }

    let (config, _) = config_pda();
    if rpc.get_account(&config).is_err() {
        send_confirm(
            &rpc,
            &payer,
            &[],
            vec![init_deployment_ix(genesis, payer.pubkey(), payer.pubkey())],
            "initialize_deployment",
        );
        println!("deployment initialized with validator genesis");
    }

    let args = tessera::CreateProjectArgs {
        project_nonce: nonce(7),
        title: "Localnet E2E".to_string(),
        terms_sha256: TERMS,
        extension_policy: 1,
        controller: None,
    };
    let project = project_pda(&payer.pubkey(), &args.project_nonce).0;
    if rpc.get_account(&project).is_err() {
        send_confirm(
            &rpc,
            &payer,
            &[],
            vec![create_project_ix(payer.pubkey(), payer.pubkey(), args)],
            "create_project",
        );
    }

    // Root (payer is both creator and contributor here).
    let mut intent = make_intent(project, None, payer.pubkey(), nonce(70), "Root", 1500);
    intent.network_genesis = genesis;
    send_confirm(
        &rpc,
        &payer,
        &[],
        vec![publish_root_ix(project, payer.pubkey(), payer.pubkey(), &intent)],
        "publish_root",
    );
    let root = node_pda(&project, &payer.pubkey(), &nonce(70)).0;

    // Child: economics verified against real chain state.
    let mut child = make_intent(project, Some(root), payer.pubkey(), nonce(71), "Child", 2000);
    child.network_genesis = genesis;
    send_confirm(
        &rpc,
        &payer,
        &[],
        vec![append_ix(project, root, payer.pubkey(), None, payer.pubkey(), &child)],
        "append_contribution",
    );

    let acc = rpc.get_account(&root).unwrap();
    assert_eq!(acc.data.len(), tessera::state::ContributionNode::SPACE);
    use anchor_lang::AccountDeserialize;
    let node = tessera::state::ContributionNode::try_deserialize(&mut &acc.data[..]).unwrap();
    assert_eq!(node.residual_out_units, 850_000_000_000);
    let child_addr = node_pda(&project, &payer.pubkey(), &nonce(71)).0;
    let cacc = rpc.get_account(&child_addr).unwrap();
    let cnode =
        tessera::state::ContributionNode::try_deserialize(&mut &cacc.data[..]).unwrap();
    assert_eq!(cnode.depth, 1);
    assert_eq!(cnode.effective_units, 170_000_000_000);
    assert_eq!(cnode.intent_digest, digest_of(&child));
    println!("live e2e passed: root {root}, child {child_addr}");

    // Compute-unit measurement via simulateTransaction.
    let mut probe = make_intent(project, Some(root), payer.pubkey(), nonce(72), "Probe", 2000);
    probe.network_genesis = genesis;
    let ix = append_ix(project, root, payer.pubkey(), None, payer.pubkey(), &probe);
    let bh = rpc.get_latest_blockhash().unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    let sim = rpc.simulate_transaction(&tx).unwrap();
    println!("append_contribution units_consumed (live): {:?}", sim.value.units_consumed);
}
