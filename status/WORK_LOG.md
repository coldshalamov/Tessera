# Work log

## Session 9 — 2026-09-13 — T04 SDK, bounded sponsor relayer and finality reconciliation

Date / agent / branch / packet: 2026-09-13 / Devin implementation agent / `packet/t04` (isolated worktree `Tessera-t04`, branched from `814c413` = main + T05 merge) / T04.

Actual files and behavior implemented:
- `packages/sdk/` (Workers-safe; fetch JSON-RPC + WebCrypto + `@noble/ed25519` only — no `@solana/web3.js`, no Anchor client): `createSolanaTesseraPort` implementing the shared `TesseraPort` plus deployment/relayer extensions — `connect` (genesis pin, program-deployed/executable check, DeploymentConfig decode + version/genesis checks), `initializeDeployment`, `createProject` (PDA init-or-compare idempotency), `quoteContribution` (real rent quotes), `prepareContribution`/`submitSignedContribution`, `preflightContribution` (shared on-chain policy gate), `buildContributionMessage` (server-side compile for sponsor co-signing), `submitSignedWire`, `getSubmission` (confirmed→finalized upgrade), `getNode` (finalized read, digest re-verify, economics recompute), `getPayouts`/`exportBranch`/`verifyRelease`, `prepareStatement`/`submitStatement` (honest `UNSUPPORTED_VERSION` scaffold — publish_statement is not deployed). Hand-written Borsh/Anchor instruction encoders, exact fixed-layout account decoders, legacy Solana transaction compiler/parser/serializer, PDA derivation, error mapping, reconcile-aware submission (never blindly resubmits; PDA compare decides replay/conflict/expired). `mainnet` mode is read-only (`MAINNET_WRITES_DISABLED`).
- `services/relayer/` (local/devnet only; mainnet refused at config): two-call intake — `prepare` compiles the canonical message itself after consent-signature verify + on-chain preflight, `submit` verifies every required client signature over the stored message, runs exact-match `reviewSponsoredMessage` (allowlisted program/discriminators/account-metas, sponsor-is-fee-payer, no stray signers/instructions/system transfers), enforces mandatory daily + per-account lamport caps, then co-signs as fee payer and submits via the SDK path. Arbitrary client wire bytes are never accepted. Atomic tmp+rename JSON outbox (corrupt file = hard failure, recorded intents never dropped), idempotency keys bound to intent digests, dead blockhashes rebuild + require fresh client signature, kill-switch env/file pause, append-only secret-free JSONL audit, bounded HTTP adapter + CLI. Sponsor key loaded once at boot from `TESSERA_SPONSOR_KEYPAIR_FILE`/`_JSON` only.
- `packages/types/src/port.ts` (the only shared-contract touch): additive `PortErrorCode` members for chain-adapter + relayer failures (`RPC_UNREACHABLE`, `TRANSACTION_EXPIRED`, `NETWORK_MISMATCH`, `PROGRAM_NOT_DEPLOYED`, `INSTRUCTION_REJECTED`, `MAINNET_WRITES_DISABLED`, `SPONSOR_PAUSED`, `MISSING_TX_SIGNATURES`) — backward-compatible, no renames; existing codes (`INVALID_SIGNATURE`, `NONCE_REUSE_MISMATCH`, `SPONSOR_BUDGET_EXHAUSTED`, `UNSUPPORTED_VERSION`, …) reused unchanged.
- `tests/sdk/` (66 Vitest cases): golden account-layout decode vs `generated/vectors/account-layout-v1.json`, IDL discriminator pinning vs `generated/idl/tessera.json`, tx compile/parse/signature-order suite, mock-RPC port suite (connect checks, mainnet refusal, statement scaffold, digest equality, simulate→send→poll, idempotent replay, consent/digest/Custom-error mapping, payouts, getNode re-verification), relayer review/outbox/config/service suite (8-case reject matrix, caps, kill switch, idempotent intake, audit content), and the env-gated live proof.
- `reports/sdk-conformance.md` (all measured values + honest gaps); BACKLOG T04 → DONE; REPO_MAP implementation rows; `.gitignore` covers the packed tarball.

Commands run and exact results:
- `pnpm -r build` → exit 0 (all 7 packages emit `dist/`). `pnpm -r test` → exit 0: tests/signatures 110, tests/math 169, tests/evidence 50, tests/sdk **65 pass + 1 env-gated skip** (394 total). `pnpm -r typecheck` → exit 0 (12 projects, strict). `pnpm lint` → exit 0 (0 warnings/0 errors, oxlint 91 files).
- WSL2: `CARGO_TARGET_DIR=/root/tessera-target anchor build --arch v2` → `tessera.so` 229,064 B, sha256 `a097fe4c…0085` — byte-identical to T03 (no program drift). `solana-test-validator --bpf-program …` on 127.0.0.1:8899, genesis `2yBx3b8KtEU1i9YYstVXPMAJh5K8SsYWcYRuuADwYCs9`.
- `TESSERA_SDK_LIVE=1 pnpm --filter @tessera-tests/sdk test` → **pass (53.7 s)**: live initialize_deployment + create_project + publish_root + relayer-sponsored child/sibling appends; on-chain `intent_digest` equals the SDK/`types` wire digest; same-intent resubmit returns the same submission id with zero sends (PDA-compare replay); `getTransaction` shows sponsor as `accountKeys[0]` fee payer; wrong-genesis `connect` rejected (`NETWORK_MISMATCH`); submissions observed confirmed→finalized. Outbox recorded sponsor outlay **6,183,520 lamports/contribution** — exactly T03's measured rent+fee.
- `pnpm --filter @tessera/sdk pack` → `tessera-sdk-0.1.0.tgz`, sha256 `d5b3a21f0f9cee56ed22e82b688cb1230a5d455ec93b3db50cc9aeec4d0896a1` (gitignored; contains dist + src + README + package.json).

Visual/browser evidence: n/a — library/service packet; live-chain evidence quoted above and in the report.

Contract/migration/security implications: `docs/`, `schemas/`, `shared/`, `fixtures/`, `programs/tessera`, Morpheus untouched (verified via `git status`); program binary rebuilt byte-identical. Only additive error-code extension in `packages/types`. No secrets committed — all live-run keypairs were ephemeral in-memory; keypair files are gitignored. Localnet finality is labeled chain-commitment truth, not mainnet permanence; devnet was not exercised (needs funded sponsor + ops decision).

External gates and smallest needed founder action: none for T04 itself. Devnet run needs a funded devnet sponsor wallet (founder action, T09). Relayer production hardening (auth/TLS/HSM custody, high-throughput store) remains T07/T09 scope.

Saved commit/artifact and next ready packet: single commit on `packet/t04` (not merged). **T06 ready** (explorer consumes the SDK port); T07 can now attack the real relayer/SDK surface; T09 consumes the measured sponsor costs.

## Session 8 — 2026-09-13 — T06 generic explorer and non-audio demonstration

Date / agent / branch / packet: 2026-09-13 / Devin implementation agent / `packet/t06` / T06 (continued — a prior agent was killed early leaving an uncommitted scaffold; inspected, kept, corrected, finished).

Actual files and behavior implemented:
- `apps/explorer/` (Vite 7.3.6 + React 19.3.0 + TS, read-only, no wallet/ticker/Morpheus concepts): source panel (bundle `.zip`/lone `bundle.json` drop+picker, node-address inspect scoped to loaded data, in-tab demo); chain context (genesis/program/project/mode/exporter/record count/leaf); ARIA `tree` with roving tabindex and full keyboard control — every node inspectable without a canvas; selected-version facts incl. claim bps, residual in→out, effective units, issued total, exact as-is ratio, custody, digests, references, clickable ancestors; as-is payout table (exact `num/den` authority + display-only %, outside-chain naming) re-denominating per selected version; settlement preview via `allocateMinorUnits` with conservation line; per-check verification panel with plain-language help and banned-phrase-free statuses; export buttons (bundle bytes + report JSON) with honest "download unavailable" fallback. All loads go through `packages/evidence` readers/verifier; all economics through `packages/math` — no reimplemented logic.
- `apps/explorer/src/demo/stems.ts`: "Night Circuit" non-audio demo — 5 signed music-stem contributions (root 2000 bps; sibling drum/bass branches 3000/2500 bps; melody 1500; mix 1000 with cross-branch references), real local port + real bundle writer + RELEASE_ANCHOR release manifest; selected leaf denominates at 571.6e9 issued. Fixture-grade throwaway keys, local simulated mode labels.
- `tests/explorer/` (24 Vitest cases, jsdom + real WebCrypto): demo load, exact ratios, re-denomination incl. hash tracking, root-collapse, settlement DOM-vs-library equality + conservation + malformed/boundary rejections, per-check WARN/identity/finality non-claims + banned-phrase DOM scan, keyboard navigation/selection, pasted-address hit/miss, zip + manifest-only + non-bundle + tampered loads, download-unavailable honesty, model-level loader/tree/economics/settlement coverage.
- `apps/explorer/e2e/` (7 Playwright cases, `@playwright/test` 1.63.0 pinned, real Chromium 153 against `vite preview` of the built bundle): demo labels, nested-click regression, keyboard-only flow, file-picker round-trip, 320px no-horizontal-scroll, reduced-motion, committed screenshots `e2e/artifacts/*.png`. `test:e2e` is deliberately outside `pnpm -r test` (browserless CI stays green).
- `reports/explorer-qa.md`; BACKLOG T06 → DONE; REPO_MAP implementation rows.

Bugs found by the tests in the inherited scaffold (verified failing first, then fixed — evidence the suite tests behavior, not renders):
- nested treeitem `<li>` click bubbled to ancestors' `onClick` — clicking a child selected the root; fixed with `stopPropagation` (e2e regression test).
- `settlementPreview` passed decimal strings to `allocateMinorUnits`, whose strict `integer()` guard rejects strings — converted to bigint for amount + weights after digit validation.
- `pattern="[0-9]*"` on the amount input let native validation block submits silently before the app's honest `INVALID_AMOUNT` message; `pattern` removed so the explicit error path is reachable/tested (verified: jsdom enforces pattern on submit).
- roving-focus state could lag a programmatic `.focus()` by a render; `keyDown` now resolves the event's actual target treeitem first, `onFocus` syncs state (guarded against focusin bubbling from descendant treeitems).

Commands run and exact results: `pnpm install` exit 0 (11 projects); `pnpm -r build` exit 0 (4 tsc packages + apps/cli tsc + `vite build` → dist JS 344.20 kB/gzip 108.32 kB); `pnpm -r test` exit 0 — tests/math **169/169**, tests/signatures **110/110**, tests/evidence **50/50**, tests/explorer **24/24**; `pnpm -r typecheck` exit 0 (10 projects); `pnpm lint` exit 0 (0 warnings/0 errors, 82 files). `pnpm exec playwright --version` → not found initially (no dep); installed pinned `@playwright/test@1.63.0` + `playwright install chromium` (chromium/headless-shell 1243; cache held only ≤1234). `pnpm --filter @tessera/explorer test:e2e` → **7 passed (12.6s)**. Preview port note: `vite preview` bound `::1` on this host — config uses `localhost:4817` (4173 was already serving an unrelated process).

Visual/browser evidence: `apps/explorer/e2e/artifacts/explorer-desktop.png` (1280×900) + `explorer-320px.png` (320×800 full page) committed; real-browser assertions in `e2e/smoke.spec.ts` cover labels, tree, table, keyboard, file input, responsive and reduced-motion paths.

Contract/migration/security implications: none — `docs/`, `schemas/`, `shared/`, `fixtures/`, `packages/` sources untouched (verified via `git status`); explorer consumes them read-only via src aliases (same convention as tests/*). Packet path deviation: none — `apps/explorer/**`, `tests/explorer/**`, `reports/explorer-qa.md` all as targeted. New pinned deps: react/react-dom 19.3.0, vite 7.3.6, @vitejs/plugin-react 5.2.0, vitest/jsdom/RTL chain (tests), @playwright/test 1.63.0 (e2e only). No secrets; demo keys are deterministic throwaway fixtures labeled as such.

External gates and smallest needed founder action: none for T06. Not implemented (later packets): live RPC source/node lookup beyond the loaded bundle (needs T04 adapter), progressive loading beyond the reader's existing zip caps, graph canvas (optional enhancement — table/tree path already exposes every node).

Saved commit/artifact and next ready packet: single commit on `packet/t06` (not merged). **T04 remains the unblock for live reads**; T07 can now attack the explorer's bundle surface; T10 receives the independent generic demo + explorer as specified.


## Session 7 — 2026-09-12 — T05 independent evidence export, verifier and recovery

Date / agent / branch / packet: 2026-09-13 / Devin implementation agent / `packet/t05` / T05.

Actual files and behavior implemented:
- `packages/evidence/` (Workers-safe, zero `node:*` imports; WebCrypto + fflate 0.8.3): safe bundle writer/reader (`bundle.ts`), strict ZIP reader/writer with path traversal/zip-slip/duplicate/symlink/encrypted/zip64/zip-bomb rejection (`zip.ts`, `paths.ts`), manifest build + lenient parse (`manifest.ts`), structured pass/fail/warn/incomplete/skipped reports (`report.ts`), ancestry reconstruction + residual-v1 recomputation + frozen payout-table rebuild (`recover.ts`), full offline verifier (`verify.ts` — 21 named checks), minimal `getAccountInfo`/`getMinimumBalanceForRentExemption` RPC probes with labeled trust assumptions (`rpc.ts`), docs/14 field-sum storage quote (`quote.ts`), local-port session serialization (`session.ts`), export assembly (`export.ts`), deterministic demo session (`demo.ts`).
- `apps/cli/` (`tessera-evidence`): `inspect`, `verify`, `export --from-port`, `quote`, `recover-known-project`, `demo`; exit codes 0/1/2/3/4/5/6 distinguish ok/usage/invalid/incomplete/unsupported/unreadable/network.
- `tests/evidence/` (50 Vitest cases): all packet tamper classes (payload bytes, manifest hash/path, signature, economic field, wrong digest, missing ancestor → incomplete, missing terms → incomplete), unsupported-vs-malformed-v1 distinction, forward-compat unknown-kind preservation, traversal/zip-bomb/boundary suite, RPC mock suite, CLI e2e, and the restore exercise — a fresh temp-dir process importing only built `dist` reconstructs the 4-node chain and the exact `x/541000000000` payout table, asserted equal to the live port's `getPayouts`.
- `reports/evidence-verifier.md`, `reports/recovery-rehearsal.md`; BACKLOG T05 → DONE; REPO_MAP implementation rows.

Commands run and exact results: `pnpm -r build` exit 0 (4 tsc packages); `pnpm -r test` exit 0 — tests/math **169/169**, tests/evidence **50/50** (5 files); `pnpm typecheck` exit 0 (6 projects); `pnpm lint` exit 0 (0 warnings/0 errors, 44 files). CLI smoke: `demo → export` self-check `valid-offline (19 pass/0 fail/2 warn/0 incomplete)`; `verify` exit 0 `VALID-OFFLINE`; `verify` on tampered zip exit 2, unsupported exit 4, unreadable exit 5, `--rpc` unreachable exit 6; `quote` prints labeled illustrative rent; `recover-known-project` prints the exact payout table.

Visual/browser evidence (when applicable): n/a — library/CLI packet; CLI text output quoted above and in reports.

Contract/migration/security implications: none to shared contracts — `docs/`, `schemas/`, `shared/`, `fixtures/` untouched (verified via `git status`). Packet path deviation: CLI lives at `apps/cli` per the packet's stated target (`apps/cli/**`) rather than `tools/`; `tools/` remains Python reference tools only. fflate added as the package's sole runtime dependency (pinned 0.8.3). No floating-point economics; local mode is labeled in bundle limitations, report status and CLI output — no chain finality claimed. Exports carry no private keys (tested).

External gates and smallest needed founder action: none for T05 itself. Not implemented (later packets): full online verification (program binary/upgrade state, decoded account data — needs T03 layout), `preview`/`recover-index`/`submit` CLI commands, real network submission.

Saved commit/artifact and next ready packet: single commit on `packet/t05` (not merged). **T06 ready** (generic explorer can consume `EvidenceVerificationReport` + bundle reader); T07 can now attack the bundle surface. `reports/recovery-rehearsal.md` is the shutdown-exercise evidence.

## Session 6 — 2026-09-12 — T03 Solana/Anchor provenance program

Date / agent / branch / packet: 2026-09-12 / Devin implementation agent / `packet/t03` (from `main` at T02 commit) / T03.

Actual files and behavior implemented:
- `programs/tessera` (new Anchor program, program id `3fkMf7oJhVkiJF3Q7N6TzbRs16gsDFrJWXHNZcSFvytX`, localnet dev keypair only): `initialize_deployment` (one-time immutable DeploymentConfig committing the cluster genesis hash as the intent `network_genesis` domain — programs cannot read genesis from a sysvar), `create_project`, `publish_root`, `append_contribution`. Manual init-or-compare PDA creation (transfer/allocate/assign CPIs) gives the required idempotent semantics: same nonce + same intent digest → success without state change (`NodeReplayed` event); same nonce + different digest → `NonceReuseMismatch`/`ProjectConflict`. `ContributionNode` and `ProjectAccount` are immutable — no mutation, close, or admin path exists; parent accounts are strictly read-only during appends (verified byte-identical after sibling appends). OPEN and REVIEWED extension policies implemented; REVIEWED requires the recorded `project.controller` key to co-sign. On-chain IntentV1 wire recomputation + SHA-256 digest (`intent.rs` encodes the exact 18-field layout; 348-byte golden fixture verified). residual-v1 economics in u64/u128 checked math; `StatementRecord` layout committed but `publish_statement` deferred to a later packet.
- `tests/program` (new pure-Cargo crate, NOT a pnpm package): `litesvm_suite.rs` — 18 tests against the real compiled `tessera.so` in LiteSVM 0.10 (happy paths incl. chain+siblings, REVIEWED co-sign, zero/100% claims, max strings+8 refs, idempotent replay; adversarial incl. wrong signer, cross-project parent, wrong genesis/program/project domain, terms mismatch, claim>10000, rounds-to-zero, nonce conflict, system-owned lookalike + malformed + non-canonical parents, depth bound, garbage/truncated ix data, missing/wrong controller, uninitialized config). `golden_vectors.rs` emits `generated/vectors/account-layout-v1.json`. `footprint.rs` prints measured CU/tx-size/sig-count table. `localnet_e2e.rs` — live `solana-test-validator` e2e gated on `TESSERA_LOCALNET_RPC`.
- Root `Anchor.toml` + `Cargo.toml` workspace (outside pnpm), root `Cargo.lock` committed for version lock. `.gitignore` extended for `target/`, `.anchor/`, `test-ledger/`, `*.so`, `*keypair*.json`. `.gitattributes` pins LF + marks `*.so` binary. `ops/localnet-t03.sh`: one-shot build→validator→deploy→rent-quote→e2e script. `generated/idl/tessera.json` committed. `reports/program-footprint.md` — all measured values.
- BACKLOG T03→DONE; REPO_MAP implementation paths updated.

Commands run and exact results (all inside WSL2 `wsl -d Ubuntu-24.04`, `CARGO_TARGET_DIR=/root/tessera-target`, explicit toolchain PATH):
- `anchor build --arch v2` → `tessera.so` 229,064 B (SBPF v2, `e_flags=0x2`; **note:** default `--arch v3` produces an artifact LiteSVM 0.10 cannot load — documented in the footprint report).
- `cargo test -p tessera` → 3/3 pass (348-B golden intent bytes; digest `17ec8005…f5cc93d`; residual-v1 vector + boundary rules).
- `cargo test -p tessera-program-tests --test litesvm_suite` → **18/18 pass**; `golden_vectors` 1/1; `footprint` 1/1 (CU: init 10,783 / create_project 14,584 / publish_root 17,978 / append 23,333 / append zero-claim 20,249 / root 100% 21,039 / max-envelope append 35,714; worst tx 1,122 B / 2 sigs).
- `solana-test-validator --reset` + `solana program deploy` → program deployed, `solana program show` confirms 229,064 B, 1.59548952 SOL program account.
- `TESSERA_LOCALNET_RPC=http://127.0.0.1:8899 cargo test -p tessera-program-tests --test localnet_e2e` → **pass**: genesis `Hk3MKZ1AZ8nTaZVQ3UaHAZYGQLi5PQ9H7N1VHs9teuRV`; rent quotes 106 B→1,628,640 / 346 B→3,299,040 / 759 B→6,173,520 / 295 B→2,944,080 lamports; live append CU 24,586; observed fee 5,000 lamports/sig.

Contract/migration/security implications: no change to `docs/`, `schemas/`, `shared/`, `fixtures/`, `packages/` — T01/T02 wire contract consumed read-only and verified byte-for-byte (the on-chain digest equals the golden fixture digest for identical fields). Program id is a dev keypair; a devnet/mainnet id is a T09 deployment decision. Upgrade authority retained on localnet only (disposable key).

External gates and smallest needed founder action: none for T03. Rust/Solana builds require WSL2 (Windows host has no Node/Solana toolchain); `ops/localnet-t03.sh` encodes the whole flow.

Saved commit/artifact and next ready packet: single commit on `packet/t03` (not merged to `main`); **T04 is ready** — it consumes `generated/idl/tessera.json`, the instruction surface, and `IdentityPort` from T02.

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
