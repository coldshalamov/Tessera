# T04 SDK conformance + bounded sponsor relayer — measured report

All values below were measured on 2026-09-13 on the `packet/t04` worktree —
Windows host (Node v24.15.0, pnpm 12.4.1) running the TypeScript suite, and
WSL2 (Ubuntu-24.04) hosting `solana-test-validator` (Agave/Solana 3.1.10)
with the T03 program loaded. Nothing here is estimated or simulated except
where a test explicitly uses the mock-RPC fixture (clearly labeled).

Program under test: `3fkMf7oJhVkiJF3Q7N6TzbRs16gsDFrJWXHNZcSFvytX`,
`/root/tessera-target/deploy/tessera.so` — **rebuilt from this worktree's
source during this packet**; sha256 `a097fe4cd5a39095ae2bb65d9d58130689f4195b18bab668ec4858eced120085`,
229,064 bytes, byte-identical to the T03 artifact.
Live-run localnet genesis: `2yBx3b8KtEU1i9YYstVXPMAJh5K8SsYWcYRuuADwYCs9`
(fresh validator; differs per run by design).

## Deliverables

| Artifact | Path | Evidence |
|---|---|---|
| Workers-safe SDK | `packages/sdk/` | 11 source modules; fetch + WebCrypto + `@noble/ed25519` only — **no `@solana/web3.js`, no Anchor client** |
| Bounded sponsor relayer | `services/relayer/` | env-config, JSON outbox, JSONL audit, HTTP adapter; never accepts client wire bytes |
| Conformance suite | `tests/sdk/` | 66 tests (65 unit + 1 env-gated live) |
| This report | `reports/sdk-conformance.md` | — |
| SDK tarball | `tessera-sdk-0.1.0.tgz` (gitignored) | sha256 **`d5b3a21f0f9cee56ed22e82b688cb1230a5d455ec93b3db50cc9aeec4d0896a1`**; contents: `dist/` (48 files) + `src/` + `README.md` + `package.json` |

## SDK architecture and contract surface

`createSolanaTesseraPort(config)` implements the shared `TesseraPort`
contract plus deployment/relayer extensions:

- **Contract methods**: `previewAppend`, `prepareContribution`,
  `submitSignedContribution`, `getSubmission`, `getNode`, `getPayouts`,
  `verifyRelease`, `exportBranch`.
- **Deployment/admin**: `connect` (genesis pin + program-deployed +
  DeploymentConfig decode/version/genesis checks), `initializeDeployment`,
  `createProject` (PDA-init-or-compare: identical params → idempotent return;
  different → `PROJECT_EXISTS`), `quoteContribution` (real
  `getMinimumBalanceForRentExemption` + fee schedule).
- **Sponsor hooks**: `preflightContribution` (the shared on-chain policy
  gate), `buildContributionMessage` (server-side compile for the relayer),
  `submitSignedWire` (simulate → send → poll → PDA-reconcile for a
  fully-signed transaction).
- **Statement scaffold**: `prepareStatement` produces correct wire
  bytes/digest; `submitStatement` returns `UNSUPPORTED_VERSION` —
  `publish_statement` is NOT deployed in v1 and the SDK says so plainly
  rather than faking a submission.
- **Modes**: `local`/`devnet` read+write; `mainnet` read-only —
  every write returns `MAINNET_WRITES_DISABLED`.

Signing is injected via `TransactionSigner` (2-member surface: `publicKey`,
`sign(message)`); `LocalTransactionSigner` loads Solana-CLI JSON keypairs for
tests/relayer. Contributor, controller and fee-payer are distinct signers —
a REVIEWED project's recorded controller must co-sign appends, and the fee
payer is never required to be an author.

Submission lifecycle (all in `port.ts`/`reconcile.ts`): intent validation →
detached-consent Ed25519 verify over the intent digest → canonical-PDA
compare (same digest = idempotent replay reported at observed finality;
different digest = `NONCE_REUSE_MISMATCH`) → instruction build →
`simulateTransaction` with sigVerify → send → bounded poll to the configured
commitment → **on timeout/expiry the canonical PDA is reconciled and the
transaction is NEVER blindly resubmitted** (landed → report truth;
conflict → `NONCE_REUSE_MISMATCH`; absent → `TRANSACTION_EXPIRED` with
rebuild instructions; unknown → `RPC_UNREACHABLE`).

Caching: immutable node accounts are cached after first fetch; submissions
upgrade to `finalized` via the stored signature on `getSubmission`.

## Bounded sponsor relayer (`services/relayer`)

Two-call intake (the relayer compiles; the client only signs):

1. `POST /v1/contributions/prepare` `{intent, consent_signature_base64,
   idempotency_key}` → schema parse → detached consent verify → on-chain
   `preflightContribution` → server-side `buildContributionMessage` →
   durable outbox row → returns `{message_base64, required_client_signers,
   blockhash, last_valid_block_height, node_address, intent_sha256}`.
2. `POST /v1/contributions/submit` `{idempotency_key, tx_signatures}` →
   every required signature verified **over the stored message bytes** →
   `reviewSponsoredMessage` exact-match gate → hard caps → sponsor co-signs
   → `submitSignedWire` → row → submission.

Safety properties, all tested:

- **Exact-match review** (`review.ts`): the decoded message must equal the
  relayer's own build — one instruction, allowlisted Tessera program id,
  sponsored discriminators only (`publish_root`/`append_contribution`),
  identical account metas in order+flags, sponsor is the fee payer, no
  signer outside the expected set. System-program transfers, extra
  instructions, substituted accounts, tampered data and wrong fee payers
  all fail `INSTRUCTION_REJECTED`.
- **Hard caps**: `TESSERA_SPONSOR_DAILY_CAP_LAMPORTS` (UTC day) and
  `TESSERA_SPONSOR_ACCOUNT_CAP_LAMPORTS` (per contributor) are **mandatory**
  config — a sponsor without caps refuses to start; exceeded intake is a
  preserved `held` row + `SPONSOR_BUDGET_EXHAUSTED`, never a dropped intent.
- **Kill switch**: `TESSERA_RELAYER_KILL_SWITCH=1` or the configured kill
  file pauses the service; recorded intents survive.
- **Idempotent intake**: the idempotency key binds to the intent digest —
  same key + different intent → `NONCE_REUSE_MISMATCH`.
- **Expiry rule**: a dead blockhash rebuilds the message and requires a
  fresh client signature — the unchanged intent/nonce makes a late-landing
  old transaction an idempotent replay, not a duplicate.
- **Durable outbox** (`outbox.ts`): atomic tmp+rename JSON file; corrupt
  file is a hard failure (recorded intents are never silently dropped);
  spend ledger keyed by UTC day and contributor.
- **Audit** (`audit.ts`): append-only JSONL, restricted field vocabulary,
  key-name scrub for secretish fields — signatures/pubkeys/digests only.
- **HTTP** (`server.ts`): dependency-free adapter; 64 KiB body cap; all
  responses are contract `PortResult` shapes.

Sponsor key custody: `TESSERA_SPONSOR_KEYPAIR_FILE` (path outside the repo)
or `TESSERA_SPONSOR_KEYPAIR_JSON` env content; the key is loaded once at
boot and never logged, audited or returned in errors.

## Test evidence

### Unit suite (`tests/sdk`, Vitest 3.2.7, run against package source)

- `accounts.test.ts` — all four golden vectors from
  `generated/vectors/account-layout-v1.json` decode field-for-field
  (verified values: node depth 1, claim 1500 bps, intent digest
  `7de807a3…`, economics `850e9/127.5e9/722.5e9`); discriminator mismatch,
  truncation, out-of-range option tag, references count >8 all reject;
  trailing allocated bytes tolerated (Anchor semantics).
- `idl.test.ts` — instruction + account discriminators byte-equal to
  `generated/idl/tessera.json`; program address pinned; exactly the four
  deployed instructions.
- `tx.test.ts` — legacy message compile→parse exactness, signature ordering
  (payer first), missing-signer refusal, payer dedup, deterministic builds,
  trailing-byte rejection, REVIEWED controller meta vs OPEN `Option<Signer>`
  None convention (program id placeholder).
- `port.test.ts` (programmable mock RPC — not a validator; wire-level
  contract only) — connect checks (genesis pin, program executable,
  config-owner/genesis/version); `MAINNET_WRITES_DISABLED`; honest
  `submitStatement` scaffold; digest-stable `prepareContribution` (digest ==
  `sha256(encodeIntentV1)` recomputed independently); full
  simulate→send→poll path to `confirmed`; idempotency-key aliasing →
  `NONCE_REUSE_MISMATCH`; existing-PDA same-digest replay sends **zero**
  transactions; different-digest → `NONCE_REUSE_MISMATCH`; bad consent
  signature → `INVALID_SIGNATURE`; simulated `Custom 6011` →
  `BRANCH_CAPACITY_EXHAUSTED`; unreachable RPC → `RPC_UNREACHABLE` with no
  secret material; `getPayouts` exact-denominator ancestor walk;
  `getNode` recomputed economics + digest re-verification.
- `relayer.test.ts` — review accept/reject matrix (8 cases), outbox
  persistence/caps/corruption, config mandatory-caps/mainnet-refusal/
  key-ref rules, and the service end-to-end against a stub port:
  prepare→sign→submit confirms; bad consent, stray signature key, wrong
  message signature, missing signatures, kill switch, both caps, already-
  landed idempotent intake, and audit-log content checks all pass.

### Live localnet proof (`tests/sdk/src/live.test.ts`)

Gated on `TESSERA_SDK_LIVE=1` (skipped otherwise — CI without WSL2 runs the
full unit suite). Commands:

```bash
# WSL2 — build + start validator with the program loaded at its pinned id
cd /mnt/c/Users/93rob/Documents/GitHub/_worktrees/Tessera-t04
CARGO_TARGET_DIR=/root/tessera-target anchor build --arch v2
solana-test-validator --ledger /tmp/t04-ledger --reset \
  --bpf-program /root/tessera-target/deploy/tessera-keypair.json \
                /root/tessera-target/deploy/tessera.so

# Windows host (WSL2 localhost-forwarding reaches 127.0.0.1:8899)
TESSERA_SDK_LIVE=1 pnpm --filter @tessera-tests/sdk test
```

**Result: pass (53.7 s).** Fresh in-memory keypairs (deployer, sponsor,
alice, bob) funded by `requestAirdrop`; nothing persisted or committed.
Proven on the real cluster:

1. `connect` — program deployed/executable at the pinned id; genesis
   `2yBx3b8K…YCs9`.
2. `initializeDeployment` — DeploymentConfig created (subsequent runs skip
   via the idempotent check).
3. `createProject` — OPEN project `T04 Live Proof` created.
4. `publish_root` via the SDK port (payer = sponsor) → `confirmed`.
5. **Digest equality**: `getNode` at finalized commitment returns the node;
   `node.intent_digest` equals `prepareContribution`'s `intent_sha256`
   (the `package/types` wire digest) and the independently recomputed
   `intentDigestHex`; economics verify `recomputed-match`.
6. **Idempotent replay**: the same signed intent resubmitted under a new
   idempotency key returns the same submission id at `confirmed`/`finalized`
   — the on-chain init-or-compare path makes it a no-op, and the SDK's PDA
   compare short-circuited before any send.
7. **Relayer sponsor path**: child (bob) + sibling (alice) contributions
   went through `RelayerService.prepare → sign → submit` → both `confirmed`;
   the durable outbox persisted the tx signatures and the spend ledger.
   Observed sponsor outlay **6,183,520 lamports per contribution** —
   exactly T03's measured rent (6,173,520) + 2-signature fee (10,000).
8. **Sponsor-as-fee-payer**: `getTransaction` on the relayer-submitted
   signature shows `accountKeys[0] == sponsor` — the sponsor paid fees+rent
   while bob/alice authored the records.
9. **Wrong-genesis rejection**: a port configured with
   `expectedGenesisHash` ≠ cluster genesis fails `connect` with
   `NETWORK_MISMATCH`.
10. **Confirmed → finalized**: `getSubmission` upgrades the recorded
    submission to `finalized` once the validator finalizes; `getNode`
    reports `chain_finality: finalized`.

## Exact gate results (this worktree, 2026-09-13)

| Command | Result |
|---|---|
| `pnpm -r build` | exit 0 — types, math, identity, sdk, evidence, relayer, apps/cli all emit `dist/` |
| `pnpm -r test` | exit 0 — tests/signatures 110, tests/math 169, tests/evidence 50, **tests/sdk 65 pass + 1 env-gated skip** (394 total) |
| `pnpm -r typecheck` | exit 0 — all 12 projects, strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| `pnpm lint` | exit 0 — 0 warnings / 0 errors (oxlint, 91 files) |
| `TESSERA_SDK_LIVE=1 pnpm --filter @tessera-tests/sdk exec vitest run src/live.test.ts` | exit 0 — 1/1 pass, 53.7 s |
| `CARGO_TARGET_DIR=/root/tessera-target anchor build --arch v2` (WSL2, this worktree) | byte-identical `tessera.so` (sha256 `a097fe4c…`) |
| `pnpm --filter @tessera/sdk pack` | `tessera-sdk-0.1.0.tgz`, sha256 `d5b3a21f0f9cee56ed22e82b688cb1230a5d455ec93b3db50cc9aeec4d0896a1` |

## Honest gaps / explicit non-claims

- **`publish_statement` is not deployed** — `submitStatement` returns
  `UNSUPPORTED_VERSION`; only `prepareStatement` (wire bytes + digest) works.
- **Devnet was not exercised** — the live proof is localnet
  (`solana-test-validator`); devnet runs need a funded devnet sponsor +
  provider RPC and remain an ops decision. Devnet evidence would still be
  labeled test evidence, never a mainnet record.
- **The relayer is a library + minimal HTTP adapter** — no TLS,
  authentication or rate limiting on the HTTP surface is claimed; deploy
  behind the platform's edge/auth layer. Sponsor key custody beyond the
  env/file reference (HSM/KMS) is out of scope for T04.
- **Outbox is a file**, not SQLite — acceptable at this scale (atomic
  rename semantics, tested crash-corruption refusal); a high-throughput
  deployment would swap the store behind the same interface.
- **`verifyRelease` chain checks are single-endpoint reads** — noted in the
  report's `chain_finality` detail; independent archival proof is T05/T07
  territory.
- **`getPayouts`/`exportBranch` traverse `economic_parent` links** — the
  localnet proof exercises depth-1 chains; deeper-tree performance is
  unmeasured.
- No changes were made to `docs/`, `schemas/`, `shared/`, `fixtures/`,
  `programs/tessera` or Morpheus; `packages/types/src/port.ts` gained
  additive `PortErrorCode` members only — `RPC_UNREACHABLE`,
  `TRANSACTION_EXPIRED`, `NETWORK_MISMATCH`, `PROGRAM_NOT_DEPLOYED`,
  `INSTRUCTION_REJECTED`, `MAINNET_WRITES_DISABLED`, `SPONSOR_PAUSED`,
  `MISSING_TX_SIGNATURES` — a backward-compatible contract extension,
  no renames; all other codes used by the SDK/relayer already existed.
