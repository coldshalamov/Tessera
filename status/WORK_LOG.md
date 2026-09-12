# Work log

## Session 3 — 2026-09-12 — T01 deterministic economics and portable types

Date / agent / branch / packet: 2026-09-12 / Devin implementation agent / `packet/t01` / T01.

Actual files and behavior implemented:
- pnpm workspace scaffold: private root `package.json` (`packageManager: pnpm@12.4.1`), `pnpm-workspace.yaml`, strict `tsconfig.base.json` (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, bundler resolution), `.oxlintrc.json`.
- `packages/types`: IntentV1 (incl. `references` 0–8), StatementV1, NodeRecordV1, ProjectV1, evidence-bundle and `NodeRef`/`TesseraPort` contract types; semantic validators returning typed `Result`s (decimal-string u64/u64/i64 bounds, base58 public keys, 32-byte hex, UTF-8 byte limits, claim range, custody/statement enums, safe bundle paths); `encodeIntentV1`/`encodeStatementV1` wire codecs matching docs/14; `sha256Hex`/`sign`/`verify` WebCrypto helpers.
- `packages/math`: exact bigint port of `tools/reference_economics.py` — `append`, `path`, `allocateMinorUnits` (largest remainder, aggregation-before-rounding, raw-key-byte tie-break), `previewAppend` with network/program/project/depth/state validation; `LocalTesseraPort` simulator reporting honest `mode: 'local'` / `finality: 'local'` (no chain finality claimed).
- `tests/math`: 169 Vitest cases — both vector files, seeded property runs (seed 20260911 × 2500 paths; seeds 1/42/3735928559 × 500), rejection/boundary suite, type/validator suite incl. 348-byte golden fixture round-trip + signature verify/tamper-reject, local-port conformance suite.
- `reports/math-conformance.md`; REPO_MAP/BACKLOG/packet-status updates.

Commands run and exact results: `pnpm -r build` exit 0; `pnpm -r test` exit 0 — 5 files, **169/169 passed** (~3 s); `pnpm typecheck` exit 0 (3 projects); `pnpm lint` exit 0 (0 warnings/errors). `python tools/reference_economics.py --self-test` passed unchanged.

Contract/migration/security implications: none to shared contracts — `docs/`, `schemas/`, `shared/`, `fixtures/` untouched (verified via `git status`); wire layout matches the current IntentV1/StatementV1 spec byte-for-byte on the golden fixture. No floating point in rights/money paths; local simulator cannot be mistaken for chain evidence (`mode`/`finality` fields say `local`).

External gates and smallest needed founder action: none for T01. Not implemented per packet scope: real signing custody, network submission, chain finality — T02+ items.

Saved commit/artifact and next ready packet: single commit on `packet/t01` (not merged to `main`); **T02 is ready** — T01 types and the fixed wire codec are its input. `tools/economic-vectors.json` named in the brief does not exist; the byte-identical `shared/economic-vectors.json` + `fixtures/economics.json` were used instead and are both executed.

## Session 2 — 2026-09-12 — spec corrections + repo baseline

Date / agent / branch / packet: 2026-09-12 / orchestrator + spec-fix agent / main / cross-cutting spec corrections (founder-approved deviations D17–D20).

Actual files and behavior implemented:
- Git baseline: repo initialized, seed committed as `3b477ee`; corrections committed on top.
- IntentV1 gains signed `references` field (u8 count 0–8 + 32B each; descriptive ancestry, non-economic); schemas, fixtures and wire doc updated; new `schemas/statement.schema.json` and `TESSERA:STATEMENT:1` StatementV1 vocabulary (APP_DEFINED, KEY_CONTINUITY, RELEASE_ANCHOR, RETRACTION_OR_DISPUTE); custody default re-ranked to platform-provisioned server-custodied Ed25519 with export (embedded provider optional); RELEASE_ANCHOR binds release manifest digest to economic leaf.
- New tools: `tools/check_shared.py` (SHA-256 drift check against sibling repo), `tools/regen_intent_fixture.py` (CSPRNG test-key fixture generator; private key never written).
- Fixtures regenerated for the new wire layout (348-byte intent, fresh test keypair, signature verified + tamper-rejected).
- `evidence-bundle` `kind` enum gained `statement`/`manifest`; budget doc notes on-chain reference storage (~260B/node worst case) and Supabase free-tier ~7-day inactivity pause.

Commands run and exact results: `validate_seed.py --skip-inventory` passed (113 links, 11 JSON); `reference_economics.py --self-test` passed; `inspect_signature_fixture.py` verified_and_tamper_rejected; `check_shared.py` passed (7 files identical to Morpheus).

Contract/migration/security implications: IntentV1 wire layout changed pre-deployment (permitted); `shared/` edits mirrored byte-identically; no deployed state exists to migrate. Statement instruction still not implemented — record format specified only.

External gates and smallest needed founder action: none for these changes. Repo visibility/remote still founder's call; Solana/Anchor toolchain absent on Windows (WSL2 or cloud env needed before T03 program build).

Saved commit/artifact and next ready packet: correction commit on main; T01 ready next.

## Seed delivery — 2026-09-11

Specification/research/agent packets supplied. Applications, program deployment, real provider setup, payments and legal clearance have not been completed. Reference math/schema tests have their own report; do not treat them as production application tests.

## Implementation entry template

Date / agent / branch / packet:

Actual files and behavior implemented:

Commands run and exact results:

Visual/browser evidence (when applicable):

Contract/migration/security implications:

External gates and smallest needed founder action:

Saved commit/artifact and next ready packet:
