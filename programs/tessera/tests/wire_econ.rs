//! Host-side unit tests for the pure program functions: IntentV1 wire
//! encoding + digest (verified against the 348-byte golden fixture) and the
//! residual-v1 economic step (verified against fixtures/economics.json).

use sha2::{Digest, Sha256};
use solana_pubkey::Pubkey;
use std::str::FromStr;
use tessera::econ::residual_v1_step;
use tessera::intent::{encode_intent_v1, intent_digest, IntentV1Fields};
use tessera::TOTAL_CAPACITY_UNITS;

fn hex_bytes(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "odd hex length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("bad hex"))
        .collect()
}

fn hex32(s: &str) -> [u8; 32] {
    hex_bytes(s).try_into().expect("expected 32 bytes")
}

fn hex16(s: &str) -> [u8; 16] {
    hex_bytes(s).try_into().expect("expected 16 bytes")
}

fn repo_path(rel: &str) -> std::path::PathBuf {
    // programs/tessera -> repo root is two levels up.
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join(rel)
}

/// Build the IntentV1Fields corresponding to the fixture values.
fn fixture_intent() -> (IntentV1Fields, String) {
    let j: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(repo_path("fixtures/intent-v1.json")).unwrap(),
    )
    .unwrap();
    let sig: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(repo_path("fixtures/intent-v1-signature.json")).unwrap(),
    )
    .unwrap();
    let custody = match j["custody_mode"].as_str().unwrap() {
        "user_controlled" => 1u8,
        "embedded_provider" => 2,
        "server_custodied" => 3,
        other => panic!("bad custody {other}"),
    };
    let refs: Vec<Pubkey> = j["references"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| Pubkey::from_str(r.as_str().unwrap()).unwrap())
        .collect();
    let parent = j["economic_parent"]
        .as_str()
        .map(|p| Pubkey::from_str(p).unwrap());
    let intent = IntentV1Fields {
        network_genesis: Pubkey::from_str(j["network_genesis"].as_str().unwrap())
            .unwrap()
            .to_bytes(),
        program_id: Pubkey::from_str(j["program_id"].as_str().unwrap()).unwrap(),
        project_address: Pubkey::from_str(j["project_address"].as_str().unwrap()).unwrap(),
        economic_parent: parent,
        references: refs,
        nonce: hex16(j["nonce"].as_str().unwrap()),
        contributor: Pubkey::from_str(j["contributor"].as_str().unwrap()).unwrap(),
        name: j["name"].as_str().unwrap().to_string(),
        title: j["title"].as_str().unwrap().to_string(),
        artifact_sha256: hex32(j["artifact_sha256"].as_str().unwrap()),
        metadata_sha256: j["metadata_sha256"].as_str().map(hex32),
        terms_sha256: hex32(j["terms_sha256"].as_str().unwrap()),
        claim_bps: j["claim_bps"].as_u64().unwrap() as u16,
        declared_at: j["declared_at"].as_str().unwrap().parse().unwrap(),
        custody_mode: custody,
    };
    (intent, sig["intent_sha256"].as_str().unwrap().to_string())
}

#[test]
fn intent_wire_bytes_match_golden_fixture() {
    let (intent, expected_digest) = fixture_intent();
    let sig: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(repo_path("fixtures/intent-v1-signature.json")).unwrap(),
    )
    .unwrap();
    let expected_wire =
        base64_decode(sig["wire_base64"].as_str().unwrap());

    let encoded = encode_intent_v1(&intent);
    assert_eq!(encoded.len(), 348, "wire length must equal fixture");
    assert_eq!(encoded, expected_wire, "wire bytes differ from fixture");

    // Program digest == fixture digest (program recompute == signing digest).
    let digest = intent_digest(&intent);
    assert_eq!(hex_bytes(&expected_digest), digest.to_vec());
    // Cross-check with an independent SHA-256 implementation.
    assert_eq!(Sha256::digest(&encoded).as_slice(), digest);
}

#[test]
fn residual_step_matches_economics_vectors() {
    let j: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(repo_path("fixtures/economics.json")).unwrap(),
    )
    .unwrap();
    // Thread the canonical path A -> ALICE, and A -> B -> C -> D.
    // Vector entries carry their own residual_in, so each can be checked
    // independently against the step function.
    for node in j["nodes"].as_array().unwrap() {
        let e = &node["expected"];
        let step = residual_v1_step(
            e["residual_in_units"].as_str().unwrap().parse().unwrap(),
            e["claim_bps"].as_u64().unwrap() as u16,
        )
        .unwrap_or_else(|_| panic!("node {} rejected", node["id"]));
        assert_eq!(step.effective.to_string(), e["effective_units"], "{}", node["id"]);
        assert_eq!(step.residual_out.to_string(), e["residual_out_units"], "{}", node["id"]);
        assert_eq!(step.issued.to_string(), e["issued_total_units"], "{}", node["id"]);
        assert_eq!(
            step.payout_numerator.to_string(),
            e["own_payout_numerator_units"],
            "{}",
            node["id"]
        );
        assert_eq!(
            step.payout_denominator.to_string(),
            e["own_payout_denominator_units"],
            "{}",
            node["id"]
        );
    }
}

#[test]
fn residual_step_boundary_rules() {
    // zero claim on root: issued = 0, payout stored as 0/0.
    let s = residual_v1_step(TOTAL_CAPACITY_UNITS, 0).unwrap();
    assert_eq!(s.effective, 0);
    assert_eq!(s.residual_out, TOTAL_CAPACITY_UNITS);
    assert_eq!(s.issued, 0);
    assert_eq!((s.payout_numerator, s.payout_denominator), (0, 0));

    // 100% claim consumes all residual; positive child claim -> exhausted.
    let s = residual_v1_step(TOTAL_CAPACITY_UNITS, 10_000).unwrap();
    assert_eq!(s.residual_out, 0);
    assert!(residual_v1_step(0, 1).is_err()); // BRANCH_CAPACITY_EXHAUSTED
    assert!(residual_v1_step(0, 0).is_ok()); // zero claim on empty residual ok

    // positive claim that rounds to zero effective units.
    assert!(residual_v1_step(9_999, 1).is_err()); // floor(9999/10000)=0
    let s = residual_v1_step(10_000, 1).unwrap(); // smallest non-zero: 1 unit
    assert_eq!(s.effective, 1);

    // claim > 10000 rejected.
    assert!(residual_v1_step(TOTAL_CAPACITY_UNITS, 10_001).is_err());
    // residual above U rejected.
    assert!(residual_v1_step(TOTAL_CAPACITY_UNITS + 1, 0).is_err());
}

/// Minimal RFC4648 base64 decode (no padding quirks in our fixture length).
fn base64_decode(s: &str) -> Vec<u8> {
    fn v(c: u8) -> i16 {
        match c {
            b'A'..=b'Z' => (c - b'A') as i16,
            b'a'..=b'z' => (c - b'a' + 26) as i16,
            b'0'..=b'9' => (c - b'0' + 52) as i16,
            b'+' => 62,
            b'/' => 63,
            b'=' => -1,
            _ => -2,
        }
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut nbits = 0u32;
    for &c in s.as_bytes() {
        let x = v(c);
        if x < 0 {
            continue;
        }
        acc = (acc << 6) | x as u32;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push((acc >> nbits) as u8);
        }
    }
    out
}
