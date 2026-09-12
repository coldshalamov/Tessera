# Work log

## Session 5 — 2026-09-12 — T02 identity, intent signing and exportable consent

Date / agent / branch / packet: 2026-09-12 / Devin implementation agent / `packet/t02` / T02.

Actual files and behavior implemented:
- `packages/types/src/decode.ts` (new): strict `decodeIntentV1`/`decodeStatementV1` — domain/version/tag/count/UTF-8-bound checks, no trailing bytes, then the same semantic parsers as JSON input. `wire.ts` gained `sha256Bytes`, `intentDigestBytes`, `statementDigestHex`, `statementDigestBytes`; `index.ts` re-exports decoders.
- `packages/identity` (new): `IdentityPort` contract (port.ts) — freezeConsent → signIntent/signStatement/signIdentityLink (all consent-gated; no arbitrary signing endpoint), cancelConsent (produces no record), reauthenticate (session-bound 300 s step-up ticket), exportSecretKey (raw 32-byte seed as bytes/hex/base58, reauth-gated, never logged — verified via injected logger spy). `LocalTestSigner` with CSPRNG/injected keys and honest custody disclosures; `UnconfiguredProviderSigner` external boundary returning `PROVIDER_NOT_CONFIGURED`; KEY_CONTINUITY helpers (`buildKeyContinuityLink` + `verifyKeyContinuity` implementing canonical `tessera.identity-link/1` payload with the new key's countersignature, fraud-claim surfacing with `requires_dispute_check`); `verifyIntentSignature`/`verifyStatementSignature`/`verifyIntentWire` with explicit network/program/project scope rejection. Signing via `@noble/ed25519@3.2.0` (pinned; pure-JS Workers-safe; no extra deps); canonical sorted-key JSON view helpers per docs/03.
- `tests/signatures` (new, 110 tests): golden 348-byte fixture decode→re-encode byte-identity + signature verified under noble AND WebCrypto; generated vectors (9 intent + 4 statement incl. all four statement types); every-field mutation digest/signature invalidation incl. each references entry and wire-level tampering; cross-network/program/project replay rejection; UTF-8 multibyte byte-bound vectors; references 0/1/8 ok, 9 rejected; consent/cancel/reauth/export semantics incl. SIGNER_MISMATCH (signer A cannot sign B's artifact) and independent WebCrypto verification of exported keys; KEY_CONTINUITY round-trip + fraudulent-rotation claim surfacing; RELEASE_ANCHOR manifest-digest binding.
- `tests/signatures/vectors/intent-v1-vectors.json` + `statement-v1-vectors.json`: committed golden vectors (fixture_only test keys; private seeds never written), regenerable via `tests/signatures/gen-vectors.mjs`.
- `reports/identity-spike.md`: Privy/Crossmint export, recovery and MAU/MAW pricing facts from current public docs (URLs + access date); exact founder action recorded; no live provider tested.
- BACKLOG T02→DONE, T03 READY note; REPO_MAP implementation paths.

Commands run and exact results: `pnpm -r build` exit 0 (types, math, identity emit dist); `pnpm -r test` exit 0 — tests/math 169/169, tests/signatures **110/110** (Vitest 3.2.7); `pnpm typecheck` exit 0 (5 projects, strict); `pnpm lint` exit 0 (0 warnings/0 errors). `pnpm gen-vectors` exit 0 (9 intent + 4 statement vectors).

Contract/migration/security implications: wire bytes unchanged — decoder verified byte-for-byte against the 348-byte fixture; `docs/`, `schemas/`, `shared/`, `fixtures/` untouched. Identity-link JSON format `tessera.identity-link/1` is a T02 convention (sorted-key compact preimage, new-key countersignature over its SHA-256) — Morpheus needs the same convention when consuming continuity records. No secrets committed; vector keys are generated fresh and discarded.

External gates and smallest needed founder action: managed embedded provider is an approval gate — founder must choose Privy vs Crossmint, create the account/app, supply credentials via env, and approve MAU/MAW pricing + recovery/export semantics (details in `reports/identity-spike.md`); until then `UnconfiguredProviderSigner` keeps production signing disabled.

Saved commit/artifact and next ready packet: single commit on `packet/t02` (not merged to `main`); **T03 is ready** — wire format, decoders, digests and detached-signature conventions are its verification targets; T04 consumes `IdentityPort` as the signing boundary.

## Session 4 — 2026-09-12 — T08 prior art, licensing and legal-evidence documentation

Date / agent / branch / packet: 2026-09-12 / Devin implementation agent / `packet/t08` / T08.

Actual files and behavior implemented:
- `reports/prior-art-matrix.md` — primary-source matrix: OpenTimestamps, OriginStamp→OriginVault, Solana Attestation Service, Story Protocol→**The DATA Foundation** (rebrand found live: $IP→$DATA, docs.datafdn.org, PIL verified), KOR Protocol/Korus, Splits (0xSplits), Metaplex Token Metadata, W3C PROV, C2PA/Content Credentials, Mycelia Creative Passport vs. Tessera residual-v1. Every comparator fetched 2026-09-12 with does/doesn't/Tessera-difference/what-they-do-better; unknowns explicitly marked.
- `reports/naming-collision.md` — Tessera: ConsenSys Tessera (repo archived 2026-06-01), tessera.pe Solana private-markets platform, ex-Fractional.art NFT Tessera, npm `tessera`; Morpheus: HPE Morpheus, mor.org MOR network, Morpheus.Network, npm `morpheus`, MorpheuS music-gen, cultural uses. Severity + options; no rename performed (D16 gate).
- `reports/license-inventory.md` — MIT/Apache-2.0/GPL/LGPL-MPL/BUSL tradeoffs for spec+SDK+program; actual dependency inventory from pnpm-lock + node_modules scan (0 runtime deps; all dev deps MIT/Apache-2.0/ISC/BSD-3-Clause, no copyleft); LICENSE_DECISION.md state. No license chosen.
- `reports/claim-wording.md` — paste-ready signature/terms/evidence/payout/persistence/dispute wording consistent with docs/11+05+02+06, plus a banned-phrase list usable as a lint check.
- `reports/founder-legal-queue.md` — explicit checkbox queue keyed to D12–D16 + smaller items.
- `docs/12` addendum (Story→DATA rebrand, KOR, ConsenSys archival, tessera.pe), BACKLOG T08 → DONE, packets/T08 status line.
- Note: packet text listed `reports/naming-risk.md`, `reports/legal-review-questions.md`, `docs/public-claims.md` as targets; the founder's T08 brief renamed them to `naming-collision.md`, `founder-legal-queue.md`, `claim-wording.md` — same scope.

Commands run and exact results: `python tools/validate_seed.py --skip-inventory` in a clean worktree of commit `0157bc9` → **passed** (131 local links, 20 JSON files, 0 errors). Baseline note: `main` was already failing this check on `tests/math/tsconfig.json` (JSONC comments vs. strict `json.loads`); comments removed, no semantic change (tsc reads strict JSON fine). In the live working tree the validator additionally reports pre-existing environmental noise: `node_modules/` README links (untracked, gitignored) and another agent's uncommitted `packages/identity/` — none are this packet's files. Web fetches: opentimestamps.org, attest.solana.com, originstamp.com, w3.org/TR/prov-overview, spec.c2pa.org, contentcredentials.org, splits.org, developers.metaplex.com/token-metadata, github.com/ConsenSys/tessera, docs.tessera.pe, story.foundation, docs.datafdn.org (+ PIL page), morpheusdata.com, korprotocol.io, techdocs.korprotocol.io, myceliaformusic.org, npm registries for tessera/morpheus — all 2026-09-12. Story's old docs URLs (docs.story.foundation) failed post-rebrand; royalty-module detail marked unverified.

Visual/browser evidence (when applicable): n/a — documentation packet.

Contract/migration/security implications: none — `packages/`, `programs/`, `schemas/`, `shared/`, `fixtures/`, `../Morpheus` untouched except one comment-only edit: `tests/math/tsconfig.json` comments stripped to satisfy the required validator (flagged deviation from the packet's path restrictions; trivial no-op, needed to clear a pre-existing main failure). `docs/12` gained a dated addendum only. No code, no license file, no rename, no purchases. Branch note: a concurrent agent switched the shared working tree to `packet/t03` mid-session; the commit was moved to `packet/t08` and `packet/t03` restored to `ab2f61d` with their uncommitted work left intact.

External gates and smallest needed founder action: full decision queue in `reports/founder-legal-queue.md`; smallest next action is the D16 trademark knockout search before any brand spend, and the license choice (MIT vs Apache-2.0 comparison ready) before repo goes public.

Saved commit/artifact and next ready packet: single commit on `packet/t08` (not merged). T09/T10 can now consume honest-claims wording and the founder queue; no legal clearance is presumed by this packet.

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
