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
| 7 | references | u8 count (0–8) + count × 32 bytes | Descriptive ancestry refs; non-economic |
| 8 | nonce | 16 bytes | CSPRNG uniqueness/idempotency |
| 9 | contributor | 32 bytes | Native signer and beneficiary |
| 10 | name | bounded string | Self-chosen assertion label |
| 11 | title | bounded string | Artifact label |
| 12 | artifact_sha256 | 32 bytes | Exact contributed bytes |
| 13 | metadata_sha256 | optional 32 | Exact metadata-file bytes |
| 14 | terms_sha256 | 32 bytes | Project master contribution agreement |
| 15 | claim_bps | u16, <=10,000 | Residual fraction |
| 16 | statement_code | u8 = 1 | `CONTRIBUTE_AND_ACCEPT_TERMS` |
| 17 | declared_at | i64 | Untrusted client-declared time |
| 18 | custody_mode | u8: 1 user, 2 embedded, 3 server | Disclosed signing context |

`intent_digest = SHA256(IntentV1 bytes)`. Detached signature is Ed25519 over these 32 digest bytes. Native Solana instruction carries the semantic fields and requires the contributor as a signer; the program re-encodes/checks the same digest before storing it. A node's network-observed slot/time and derived economic fields are deliberately not signed as client assertions; they are computed by the program. A client can precompute the math for review, but its supplied cache is not authority.

## Network binding

A program cannot infer the genesis hash from the Clock sysvar. Each deployment therefore has a reviewed immutable network-domain constant/configuration matching the target cluster, and rejects intents with a different value. The SDK queries `getGenesisHash` and checks it against the release/deployment manifest. Do not claim on-chain genesis validation exists merely because the client supplied a field. Program ID is checked against the executing program. The deployment manifest publishes the expected domain and binary hash.

## Parent, terms and identity

Root residual is U. Child parent must be a valid node of the same project/program; child `terms_sha256` must equal the immutable project's master agreement hash. This prevents replacing the core project bargain with an arbitrary hash, but does **not** prove that contributed material is legally licensed. Additional work-specific permissions/constraints are metadata and application review; their incompatibility blocks application publication when known. Future explicit agreement amendments require a new versioned design.

`references` is a signed, bounded list of up to eight additional node addresses recording descriptive ancestry or dependency (for example, a source-text node consulted for a derivative recording). Entries are already scoped by fields 3–5, so each value is a bare node address within the same network/program/project. They are not economic parents: they do not affect arithmetic, residual capacity or payout denominators. The SDK/application layer must enforce that referenced nodes exist and display them honestly; the program stores the list as declared. An economic multi-parent merge remains a future explicit versioned design, not a reinterpretation of this field.

Beneficiary equals contributor key in v1. A arbitrary `pay_to` address cannot be inserted by the platform. Bank-account routing is separately verified by Morpheus/processor and does not mutate recorded economic identity.

## StatementV1 records

Statements are a second signed record family under domain separator `TESSERA:STATEMENT:1`. They are append-only annotations: a statement never mutates node economics, reallocates claims or erases a prior record.

| Order | Field | Wire form | Meaning |
|---:|---|---|---|
| 1 | domain | fixed ASCII bytes `TESSERA:STATEMENT:1` | No terminator/length prefix |
| 2 | format_version | u8 = 1 | Statement format |
| 3 | network_genesis | 32 bytes | Target network domain |
| 4 | program_id | 32 bytes | Exact target program |
| 5 | project_address | optional 32 | Absent for identity-scoped statements |
| 6 | statement_type | u8 | 1 `APP_DEFINED`, 2 `KEY_CONTINUITY`, 3 `RELEASE_ANCHOR`, 4 `RETRACTION_OR_DISPUTE` |
| 7 | subject_ref | optional 32 | Node address being annotated/finalized |
| 8 | aux_key | optional 32 | `KEY_CONTINUITY`: the new public key |
| 9 | payload_sha256 | 32 bytes | Digest of the referenced payload |
| 10 | declared_at | i64 | Untrusted client-declared time |
| 11 | custody_mode | u8: 1 user, 2 embedded, 3 server | Disclosed signing context |

`statement_digest = SHA256(StatementV1 bytes)`; detached Ed25519 signature conventions match IntentV1 and the native transaction signer is the statement's author. `payload_sha256` commits the exact payload bytes — for example a release-manifest or terms digest — without embedding them on-chain.

For `KEY_CONTINUITY` the signer is the old key and `aux_key` carries the new public key; `payload_sha256` is the SHA-256 of a canonical identity-link JSON which should embed the new key's countersignature so both sides attest. Chained records form a verifiable A→B→C identity lineage that survives the application's disappearance. A compromised old key can sign a fraudulent continuity record, so applications must display lineage **and** dispute state honestly rather than presenting rotation as proof of control.

For `RELEASE_ANCHOR`, `subject_ref` references the release's economic leaf node and `payload_sha256` is the release manifest digest, binding the sold artifact to its exact economic version on-chain. `RETRACTION_OR_DISPUTE` annotates `subject_ref` without erasing it. `APP_DEFINED` reserves an application-namespaced annotation whose meaning lives in the payload, not the core schema.

## PDA seeds

Project: ASCII `tessera_project`, creator 32-byte public key, 16-byte project nonce, standard PDA bump. Node: ASCII `tessera_node`, project address, contributor address, 16-byte contribution nonce, standard bump. Seed order is normative. Use official Solana PDA derivation; do not roll your own curve/off-curve check. The same signer nonce in two projects is distinct, but reuse within a project must compare the intent digest and reject a semantic mismatch.

## State account layout

Use a generated Anchor/Borsh account codec with explicit discriminator and state version. Store project/parent/contributor, bounded name/title, intent/artifact/optional metadata/terms digests, the bounded references list, nonce, claim, all seven economic fields from the economic spec, custody mode, declared time, observed slot/time, depth and bump. The field order and discriminator become normative in the generated IDL/golden vectors at T03. A framework-discriminator change is a layout change, not an invisible implementation detail.

This packet provides an **intent signing vector**, not a deployed account-address/PDA proof or an implemented Anchor IDL. Program-account golden vectors require the actual chosen toolchain, field layout and program ID during implementation. T03 is incomplete until they are committed and size-tested.

## Arithmetic fields and export

Export raw integer units and exact numerator/denominator. Format/custody labels are strings in JSON mapped to explicit wire enums. JSON metadata_schema is a retrieval/interpretation hint for metadata; economic authority remains the core. No metadata URI is signed as an assertion that the host will live forever.
