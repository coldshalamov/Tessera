# Proposed binary layout v1 and semantic constraints

This appendix removes ambiguity from the serialization proposal. The initial program/SDK spike may change this layout **before** the first deployed v1 release; it must update this file, JSON schemas, golden vectors and both repos' integration contract together. After deployment, never change v1 bytes in place.

## Encoding primitives

All integers are unsigned little-endian unless specified. `u8`, `u16`, `u64` are exactly 1, 2, 8 bytes. Declared Unix time is signed `i64`. Public keys/digests are fixed 32-byte values. A string is `u32` byte length followed by exactly those UTF-8 bytes; validate byte length before allocation. An optional 32-byte value is one tag byte (`0` absent, `1` present) followed by 32 bytes only when present. No padding and no trailing bytes in an intent.

No Unicode normalization occurs during signing. Reject invalid UTF-8 and prohibited control characters before consent; display escape/safe rendering never changes signed originals. `name` is 1–64 UTF-8 bytes, title 0–96. Metadata is optional; artifact/terms digests are required. Name uniqueness/identity verification is not a protocol operation.

## IntentV1 field order

| Order | Field | Wire form | Meaning |
|---:|---|---|---|
| 1 | domain | fixed ASCII bytes `TESSERA:CONTRIBUTION:1` | No terminator/length prefix |
| 2 | format_version | u8 = 1 | Intent format |
| 3 | network_genesis | 32 bytes | Target network domain |
| 4 | program_id | 32 bytes | Exact target program |
| 5 | project_address | 32 bytes | Exact project |
| 6 | economic_parent | optional 32 | Absent only for root |
| 7 | nonce | 16 bytes | CSPRNG uniqueness/idempotency |
| 8 | contributor | 32 bytes | Native signer and beneficiary |
| 9 | name | bounded string | Self-chosen assertion label |
| 10 | title | bounded string | Artifact label |
| 11 | artifact_sha256 | 32 bytes | Exact contributed bytes |
| 12 | metadata_sha256 | optional 32 | Exact metadata-file bytes |
| 13 | terms_sha256 | 32 bytes | Project master contribution agreement |
| 14 | claim_bps | u16, <=10,000 | Residual fraction |
| 15 | statement_code | u8 = 1 | `CONTRIBUTE_AND_ACCEPT_TERMS` |
| 16 | declared_at | i64 | Untrusted client-declared time |
| 17 | custody_mode | u8: 1 user, 2 embedded, 3 server | Disclosed signing context |

`intent_digest = SHA256(IntentV1 bytes)`. Detached signature is Ed25519 over these 32 digest bytes. Native Solana instruction carries the semantic fields and requires the contributor as a signer; the program re-encodes/checks the same digest before storing it. A node's network-observed slot/time and derived economic fields are deliberately not signed as client assertions; they are computed by the program. A client can precompute the math for review, but its supplied cache is not authority.

## Network binding

A program cannot infer the genesis hash from the Clock sysvar. Each deployment therefore has a reviewed immutable network-domain constant/configuration matching the target cluster, and rejects intents with a different value. The SDK queries `getGenesisHash` and checks it against the release/deployment manifest. Do not claim on-chain genesis validation exists merely because the client supplied a field. Program ID is checked against the executing program. The deployment manifest publishes the expected domain and binary hash.

## Parent, terms and identity

Root residual is U. Child parent must be a valid node of the same project/program; child `terms_sha256` must equal the immutable project's master agreement hash. This prevents replacing the core project bargain with an arbitrary hash, but does **not** prove that contributed material is legally licensed. Additional work-specific permissions/constraints are metadata and application review; their incompatibility blocks application publication when known. Future explicit agreement amendments require a new versioned design.

Beneficiary equals contributor key in v1. A arbitrary `pay_to` address cannot be inserted by the platform. Bank-account routing is separately verified by Morpheus/processor and does not mutate recorded economic identity.

## PDA seeds

Project: ASCII `tessera_project`, creator 32-byte public key, 16-byte project nonce, standard PDA bump. Node: ASCII `tessera_node`, project address, contributor address, 16-byte contribution nonce, standard bump. Seed order is normative. Use official Solana PDA derivation; do not roll your own curve/off-curve check. The same signer nonce in two projects is distinct, but reuse within a project must compare the intent digest and reject a semantic mismatch.

## State account layout

Use a generated Anchor/Borsh account codec with explicit discriminator and state version. Store project/parent/contributor, bounded name/title, intent/artifact/optional metadata/terms digests, nonce, claim, all seven economic fields from the economic spec, custody mode, declared time, observed slot/time, depth and bump. The field order and discriminator become normative in the generated IDL/golden vectors at T03. A framework-discriminator change is a layout change, not an invisible implementation detail.

This packet provides an **intent signing vector**, not a deployed account-address/PDA proof or an implemented Anchor IDL. Program-account golden vectors require the actual chosen toolchain, field layout and program ID during implementation. T03 is incomplete until they are committed and size-tested.

## Arithmetic fields and export

Export raw integer units and exact numerator/denominator. Format/custody labels are strings in JSON mapped to explicit wire enums. JSON metadata_schema is a retrieval/interpretation hint for metadata; economic authority remains the core. No metadata URI is signed as an assertion that the host will live forever.
