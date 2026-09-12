# Specification-seed validation

Performed during packet generation. These results validate the supplied references and document package, **not** applications or deployed smart contracts that have not been built.

## Economic reference

Command: `python Tessera/tools/reference_economics.py --self-test` (from the two-folder parent; inside Tessera omit the prefix).

```json
{
  "status": "passed",
  "fixed_nodes": 8,
  "fixed_settlements": 6,
  "invalid_append_cases": 5,
  "random_paths": 2500,
  "random_steps": 80971,
  "random_allocations": 2488
}
```

The suite includes fixed node/settlement vectors, invalid claim cases, exact capacity/money conservation, repeated-beneficiary aggregation, input-order independence, zero-issued rejection and randomized paths with deterministic seed 20260911. Python arbitrary-precision integers avoid floating-point ambiguity. Rust/TypeScript and actual program conformance remain implementation tasks.

## Signature/byte reference

Command: `python Tessera/tools/inspect_signature_fixture.py --require-signature`.

```json
{
  "binary_decode": "passed",
  "file_hashes": "passed",
  "wire_bytes": 315,
  "ed25519": "verified_and_tamper_rejected",
  "chain_status": "fictional_fixture_not_deployed"
}
```

This is a genuine signature over a fictional local-context intent, with exact original-file hash checks and tamper rejection. It is not a Solana account, transaction, live network identity, legal agreement or chain-finality proof. The optional signature check used the installed Python cryptography implementation.

## Schemas and package

7 draft JSON schema documents passed Draft 2020-12 metaschema checks. The supplied contribution intent and Morpheus metadata examples passed their schemas. Large integer bounds, byte-length limits, branch semantics, cryptographic checks and chain ownership still need semantic validation beyond JSON schema.

The generated repo maps/inventory and final ZIP are checked separately by the package validator. All current local Markdown links must resolve, JSON must parse, and shared-file copies must be byte-identical. The delivery manifest excludes itself and records every other file's SHA-256.

## Explicitly not performed

No app or Rust/Solana program build; no real browser UI/audio QA; no cloud resources or OAuth setup; no mainnet/devnet deployment; no live rent quote; no real payments; no external security audit; no legal/trademark clearance; no actual cast or produced recording. These remain assigned implementation/review tasks, not hidden completed work.
