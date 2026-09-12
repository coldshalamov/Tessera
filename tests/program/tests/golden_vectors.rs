//! Golden account-layout vectors (T03): serializes canonical examples of
//! every on-chain account type — including StatementRecord, whose
//! publish_statement instruction ships in a later packet — and writes them
//! to generated/vectors/account-layout-v1.json.
//!
//! These bytes are the normative account layout commitment: any change to
//! struct fields/order changes these vectors and is a wire-contract change.

use solana_pubkey::Pubkey;
use std::str::FromStr;
use tessera::intent::{intent_digest, IntentV1Fields};
use tessera::state::{ContributionNode, DeploymentConfig, ProjectAccount, StatementRecord};
use tessera_testkit::*;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn vector_entry(
    name: &str,
    space: usize,
    serialized: &[u8],
    fields: &[&str],
) -> serde_json::Value {
    serde_json::json!({
        "account": name,
        "allocated_bytes": space,
        "serialized_len": serialized.len(),
        "discriminator_hex": hex(&serialized[..8]),
        "bytes_hex": hex(serialized),
        "field_order": fields,
    })
}

#[test]
fn emit_account_layout_vectors() {
    // Deterministic example identities (fixture contributor reused for
    // recognizability; everything else is fixed test bytes).
    let contributor =
        Pubkey::from_str("4MPEkX67Yf1CApYj9PSzN6RCENYS2aFcrvHjZmpFW7Au").unwrap();
    let project = Pubkey::from_str("2K8CfN8zTE59rgTjqZxeTWxTPXFUgKGoC2uVBzYa2XSq").unwrap();
    let parent = Pubkey::from_str("5BXQSBCPDShWC5DoEKUyoFoKgaVC978Um3WiHmid718S").unwrap();
    let controller = Pubkey::new_from_array([0xc0; 32]);
    let authority = Pubkey::new_from_array([0xa1; 32]);
    let reference = Pubkey::new_from_array([0x33; 32]);

    let mut entries = Vec::new();

    // ---- DeploymentConfig ----
    let config = DeploymentConfig {
        state_version: 1,
        network_genesis: TEST_GENESIS,
        program_id: tessera::ID,
        authority,
        bump: 255,
    };
    let bytes = serialize_account(&config);
    assert_eq!(bytes.len(), DeploymentConfig::SPACE);
    entries.push(vector_entry(
        "DeploymentConfig",
        DeploymentConfig::SPACE,
        &bytes,
        &[
            "discriminator:8", "state_version:u8", "network_genesis:32",
            "program_id:32", "authority:32", "bump:u8",
        ],
    ));

    // ---- ProjectAccount ----
    let proj = ProjectAccount {
        state_version: 1,
        economic_rule: 1,
        extension_policy: 2, // REVIEWED shows the controller field populated
        bump: 254,
        network_genesis: TEST_GENESIS,
        program_id: tessera::ID,
        creator: contributor,
        controller: Some(controller),
        root_node: Some(parent),
        project_nonce: [0x0a; 16],
        title: "The Lantern Room".to_string(),
        terms_sha256: TERMS,
        total_units: tessera::TOTAL_CAPACITY_UNITS,
        created_slot: 42,
        created_unix_time: 1_789_166_400,
    };
    let bytes = serialize_account(&proj);
    entries.push(vector_entry(
        "ProjectAccount",
        ProjectAccount::SPACE,
        &bytes,
        &[
            "discriminator:8", "state_version:u8", "economic_rule:u8",
            "extension_policy:u8", "bump:u8", "network_genesis:32",
            "program_id:32", "creator:32", "controller:option<32>",
            "root_node:option<32>", "project_nonce:16",
            "title:u32len+bytes<=96", "terms_sha256:32", "total_units:u64",
            "created_slot:u64", "created_unix_time:i64",
        ],
    ));

    // ---- ContributionNode (child node, 1 reference, metadata present) ----
    let intent = IntentV1Fields {
        network_genesis: TEST_GENESIS,
        program_id: tessera::ID,
        project_address: project,
        economic_parent: Some(parent),
        references: vec![reference],
        nonce: hex_nonce(),
        contributor,
        name: "Alex".to_string(),
        title: "The Lantern Room test seed".to_string(),
        artifact_sha256: hex32_fixture("fd02088635b4bf27a9779a6aac03cd48258cb128d54f41948f052931f4127c1d"),
        metadata_sha256: Some(hex32_fixture(
            "12cc1c1f597a4173d43b0f4b553cf588785f15d0ad0e5df3d327cd9064dc0a04",
        )),
        terms_sha256: TERMS,
        claim_bps: 1500,
        declared_at: 1_789_166_400,
        custody_mode: 3,
    };
    let node = ContributionNode {
        state_version: 1,
        economic_rule: 1,
        node_state: ContributionNode::STATE_FINALIZED,
        bump: 253,
        depth: 1,
        claim_bps: 1500,
        custody_mode: 3,
        project,
        economic_parent: Some(parent),
        contributor,
        references: vec![reference],
        nonce: hex_nonce(),
        name: "Alex".to_string(),
        title: "The Lantern Room test seed".to_string(),
        intent_digest: intent_digest(&intent),
        artifact_sha256: intent.artifact_sha256,
        metadata_sha256: intent.metadata_sha256,
        terms_sha256: TERMS,
        declared_at: 1_789_166_400,
        observed_slot: 4242,
        observed_unix_time: 1_789_166_401,
        residual_in_units: 850_000_000_000,
        effective_units: 127_500_000_000,
        residual_out_units: 722_500_000_000,
        issued_total_units: 277_500_000_000,
        own_payout_numerator_units: 127_500_000_000,
        own_payout_denominator_units: 277_500_000_000,
    };
    let bytes = serialize_account(&node);
    entries.push(vector_entry(
        "ContributionNode",
        ContributionNode::SPACE,
        &bytes,
        &[
            "discriminator:8", "state_version:u8", "economic_rule:u8",
            "node_state:u8", "bump:u8", "depth:u16", "claim_bps:u16",
            "custody_mode:u8", "project:32", "economic_parent:option<32>",
            "contributor:32", "references:u32count+<=8x32", "nonce:16",
            "name:u32len+bytes<=64", "title:u32len+bytes<=96",
            "intent_digest:32", "artifact_sha256:32",
            "metadata_sha256:option<32>", "terms_sha256:32",
            "declared_at:i64", "observed_slot:u64", "observed_unix_time:i64",
            "residual_in_units:u64", "effective_units:u64",
            "residual_out_units:u64", "issued_total_units:u64",
            "own_payout_numerator_units:u64",
            "own_payout_denominator_units:u64",
        ],
    ));

    // ---- StatementRecord (layout committed; instruction deferred) ----
    let stmt = StatementRecord {
        state_version: 1,
        statement_type: 3, // RELEASE_ANCHOR
        custody_mode: 1,
        bump: 252,
        network_genesis: TEST_GENESIS,
        program_id: tessera::ID,
        project: Some(project),
        author: contributor,
        subject_ref: Some(parent),
        aux_key: None,
        payload_sha256: [0x77; 32],
        statement_digest: [0x88; 32],
        declared_at: 1_789_166_500,
        observed_slot: 4300,
        observed_unix_time: 1_789_166_500,
    };
    let bytes = serialize_account(&stmt);
    entries.push(vector_entry(
        "StatementRecord",
        StatementRecord::SPACE,
        &bytes,
        &[
            "discriminator:8", "state_version:u8", "statement_type:u8",
            "custody_mode:u8", "bump:u8", "network_genesis:32",
            "program_id:32", "project:option<32>", "author:32",
            "subject_ref:option<32>", "aux_key:option<32>",
            "payload_sha256:32", "statement_digest:32", "declared_at:i64",
            "observed_slot:u64", "observed_unix_time:i64",
        ],
    ));

    // ---- write generated/vectors/account-layout-v1.json ----
    let out = serde_json::json!({
        "format_version": 1,
        "notice": "Golden account-layout vectors for the tessera program (T03). \
                   Borsh+discriminator encoding; allocated_bytes is the fixed \
                   account allocation (rent basis), serialized_len the bytes \
                   used by this example.",
        "program_id": tessera::ID.to_string(),
        "pda_seeds": {
            "DeploymentConfig": ["tessera_config"],
            "ProjectAccount": ["tessera_project", "creator:32", "project_nonce:16"],
            "ContributionNode": ["tessera_node", "project:32", "contributor:32", "nonce:16"],
            "StatementRecord_proposed": ["tessera_statement", "author:32", "statement_digest:32"],
        },
        "accounts": entries,
    });
    let dir = repo_path("generated/vectors");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("account-layout-v1.json");
    std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap()).unwrap();
    println!("wrote {}", path.display());
}

fn hex_nonce() -> [u8; 16] {
    [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
        0x0e, 0x0f,
    ]
}

fn hex32_fixture(s: &str) -> [u8; 32] {
    let v: Vec<u8> = (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect();
    v.try_into().unwrap()
}
