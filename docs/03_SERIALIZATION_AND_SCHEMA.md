# Core record, serialization and signatures

V1 uses a bounded binary program instruction/state representation and a portable JSON view. These must be generated from the same type definition and tested against shared byte vectors. JSON is an interchange/export format, not an excuse to run an arbitrary JSON parser inside the Solana program.

## Identity and references

A `NodeRef` includes `genesis_hash`, `program_id`, `project_address` and `node_address`. Human-readable cluster labels are descriptive; genesis hash separates networks. Hash algorithm identifiers are explicit, initially SHA-256. Solana keys are base58 strings in JSON and 32 bytes on wire. `name` is one self-chosen UTF-8 string, maximum 64 encoded bytes. It is not a uniqueness constraint or verified legal identity.

Artifact is the exact byte sequence hashed; normalization/transcoding creates a different artifact. Core artifact media type is a short enum or bounded metadata field, not a legal classification. An optional title of at most 96 UTF-8 bytes helps people interpret the evidence. Unicode control/bidirectional spoofing must be handled safely in displays; do not silently change signed bytes to make them pretty.

## Contribution intent

Required semantic fields: format/rule version, network/program, project, economic parent or null for root, 16-byte random nonce, contributor public key, chosen name, title, artifact SHA-256, metadata SHA-256 or explicit absent marker, terms SHA-256, claim_bps, statement code, client-declared creation time and identity-custody disclosure. A metadata URI is a retrieval hint and MUST NOT substitute for a digest.

A signer MUST bind the statement meaning and terms digest. `CONTRIBUTE_AND_ACCEPT_TERMS` is not the same as `I_AUTHORED_EVERYTHING`. The standard statement means “I submit this artifact under the referenced terms and accept the stated economic claim.” Authorship, licenses, provenance references and role can be richer app-specific assertions.

Client time is untrusted declared time. On-chain slot and Clock timestamp are separate network observations and not a legal certified timestamp. Do not overwrite one with the other. A term text or metadata URL can go offline; successful hash comparison requires possession of the original bytes.

## Signing bytes

Define a deterministic length-prefixed binary `IntentV1` with a fixed ASCII domain separator `TESSERA:CONTRIBUTION:1`, genesis hash, program ID and the fields above. Use a pinned Borsh-compatible encoding, fixed field order, explicit option tags, checked lengths and no floating-point values. A node PDA is derived from fixed seeds plus project, signer and nonce; it is not derived from a mutable username. The implementation spike MUST publish full golden byte vectors and PDA derivation vectors before independent SDK implementation.

The native Solana transaction signature authorizes the program instruction. For a portable offline evidence bundle, also retain an Ed25519 detached signature of `SHA256(domain-separated IntentV1 bytes)`. The intent bytes/meaning match the instruction. These are distinct signatures: an offline detached signature proves a key approved an intent, not that Solana finalized it. The chain program need not redundantly verify a detached signature when it already requires that same native transaction signer; it must bind/store the intent digest and enforce that the signer equals the named contributor.

Backend-sponsored submission changes only transaction wrapper fields such as blockhash, compute budget and fee payer. It cannot change the committed parent, artifact, terms or economics. Do not allow the fee sponsor to accept an opaque arbitrary transaction from a browser.

## JSON and metadata

The generated portable view uses lower_snake_case keys, decimal strings for large integers, integers for bps, explicit nulls for absent values and `format_version`. The attached `schemas/` files are draft structural constraints; the program's published binary vectors and semantic validator are also required. Public state includes the economic fields, chosen name, key, parent, hashes and network observations, not merely a hash of a vanished website document.

Application metadata can be any bounded JSON object under `metadata_schema`. A schema identifier can be a URI plus version/hash. Unknown schemas are preserved and displayed as unvalidated metadata, not rejected if the core is valid. Hash the **exact UTF-8 metadata file bytes**; this deliberately avoids cross-language canonicalization ambiguity in v1. Writers SHOULD use deterministic sorted-key compact JSON; verifiers compare bytes and do not reserialize before checking. Any normalization creates a new digest. Binary core intent—not arbitrary metadata key order—carries the economic commitment.

Metadata MUST NOT override standard fields. If Morpheus metadata says 50% and core says 20%, verification reports an inconsistency and the core computation remains authoritative. Do not duplicate authority under app-specific names such as `royaltyPercent`.

## Versioned record view

```json
{
  "format_version": 1,
  "economic_rule": "residual-v1",
  "name": "Alex",
  "claim_bps": 1000,
  "residual_in_units": "680000000000",
  "effective_units": "68000000000",
  "residual_out_units": "612000000000",
  "issued_total_units": "388000000000",
  "own_payout_numerator_units": "68000000000",
  "own_payout_denominator_units": "388000000000",
  "metadata_schema": "morpheus.contribution/1"
}
```

This is a partial illustration, not a complete signed record. See generated schemas and fixtures for required fields. Never copy ellipses or this fragment into a test claiming to validate a real signature.

## Size budget and mutation rules

Target a measured node account at or below roughly 640 bytes, but this is an engineering target, not a verified layout. Bound all strings and keep full metadata/terms off-chain with exports. Preserve the conservative 1,232-byte transaction envelope until the target cluster's larger-transaction activation is confirmed [S13]. Multiple signatures and metadata/name lengths must be included in worst-case serialization tests. Failure at a size boundary must be visible before requesting signatures.

Program acceptance computes and stores derived fields. Core economic state is immutable. Retrieval hints can be added through separately signed supplemental records, not by altering the original statement. Key link/retraction/dispute events use distinct typed domains so a signature cannot be replayed as a contribution or transfer.
