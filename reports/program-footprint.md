# T03 program footprint — measured report

All values below were measured on 2026-09-12 inside WSL2 (Ubuntu-24.04) against
the real compiled SBF binary — not estimated. Two execution environments were
used:

- **LiteSVM 0.10** — in-process SVM running the same `tessera.so` bytecode
  (instruction-level suite + CU/transaction measurements).
- **`solana-test-validator`** (Agave/Solana 3.1.10) — live JSON-RPC end-to-end:
  program deployed, real transactions confirmed, rent quoted via
  `getMinimumBalanceForRentExemption`, real fee/CU data read back via
  `getTransaction`.

Localnet genesis for the live run: `Hk3MKZ1AZ8nTaZVQ3UaHAZYGQLi5PQ9H7N1VHs9teuRV`.
Program ID (dev keypair, localnet only): `3fkMf7oJhVkiJF3Q7N6TzbRs16gsDFrJWXHNZcSFvytX`.

## Toolchain version lock

| Tool | Version |
|---|---|
| rustc / cargo | 1.98.1 |
| anchor-cli / avm | 1.2.0 |
| solana-cli (Agave) | 3.1.10 |
| litesvm (test dep) | 0.10.0 |
| anchor-lang (program dep) | 1.2.0 |
| Python (fixture tooling) | 3.12.3 |

Rust dependency graph is pinned by the committed root `Cargo.lock`.

## Compiled program

| Metric | Value |
|---|---|
| `tessera.so` size | **229,064 bytes** |
| sha256 | `a097fe4cd5a39095ae2bb65d9d58130689f4195b18bab668ec4858eced120085` |
| ELF machine/flags | `0x107` (SBPF), `e_flags=0x2` → **SBPF v2** |
| Loader | `BPFLoaderUpgradeab1e…` (upgradeable; dev keypair holds upgrade authority on localnet only) |
| IDL | `generated/idl/tessera.json` (32,484 B, sha256 `a8e0e64ff13f8da5ab149d8312a352255fa2d2a6c49e84e282b8f59552073e4b`) |

**Build note:** `anchor build` defaults to `--arch v3`. LiteSVM 0.10's loader
rejects v3 artifacts (`invalid account data for instruction`), so the measured
binary and all test runs use `anchor build --arch v2`. The v3 artifact was
210,584 bytes; it executes correctly on a real validator but cannot be loaded
by LiteSVM 0.10.

## Account sizes (allocated bytes = rent basis)

| Account | SPACE (bytes) | Rent-exempt deposit (localnet) |
|---|---|---|
| DeploymentConfig | 106 | 1,628,640 lamports |
| ProjectAccount | 346 | 3,299,040 lamports |
| ContributionNode | 759 | 6,173,520 lamports |
| StatementRecord (layout committed; instruction deferred) | 295 | 2,944,080 lamports |

`ContributionNode` is sized for the worst case: 8 references (260 B vec),
64-byte name, 96-byte title. Golden serialized examples for all four accounts:
`generated/vectors/account-layout-v1.json` (emitted by
`tests/program/tests/golden_vectors.rs`).

Program account itself: `solana program show` reports data length 229,064 B
and balance **1.59548952 SOL** (deploy cost on localnet, one-time).

## Compute units

LiteSVM (`compute_units_consumed` on confirmed metadata; identical bytecode to
the validator run):

| Instruction | CU | Notes |
|---|---|---|
| initialize_deployment | 10,783 | 1 sig |
| create_project | 14,584 | |
| **publish_root** (claim 1500) | **17,978** | packet scenario |
| **append_contribution** (claim 2000) | **23,333** | packet scenario |
| **append_contribution, claim 0** | **20,249** | packet scenario |
| **publish_root, claim 10000 (100%)** | **21,039** | packet scenario |
| append_contribution, worst-case envelope (8 refs + 64B name + 96B title) | 35,714 | max measured |

Live `solana-test-validator` cross-check (`getTransaction.meta.computeUnitsConsumed`
for the e2e `append_contribution`): **24,586 CU** — consistent with the LiteSVM
figure (23,333; the small delta is SVM-version/runtime accounting, both are far
below the 200k default cap and the 1.4M block cap).

## Transaction size / signatures

Serialized `Transaction` (bincode) sizes measured in `tests/program/tests/footprint.rs`:

| Transaction | Bytes | Signatures |
|---|---|---|
| initialize_deployment | 277 | 1 |
| create_project | 437 | 2 (payer + creator) |
| publish_root | 657 | 2 |
| append_contribution | 724 | 2 |
| append (zero claim) | 723 | 2 |
| publish_root (100%) | 661 | 2 |
| **append, max envelope** (8 refs, max strings) | **1,122** | 2 |
| append under REVIEWED (+ controller sig) | ~724 + 64 | 3 |

Worst case (1,122 B) is well under the 1,232-byte IPv6-MTU transaction limit.

## Fees (live validator)

- Observed `meta.fee` on the confirmed e2e `append_contribution` (1 signature):
  **5,000 lamports**.
- Fee schedule is 5,000 lamports per signature → 2-signature publish/append
  transactions cost **10,000 lamports**; a REVIEWED co-signed append costs
  **15,000 lamports**.
- No prioritization fees are used (localnet, none configured).

Per-contribution worst-case cost (append, 2 sigs): fee 10,000 + rent 6,173,520
= **6,183,520 lamports ≈ 0.0062 SOL**, fully borne once (records are immutable
and never closed, so rent is never recovered).

## RPC surface of the e2e run

`tests/program/tests/localnet_e2e.rs` calls: `getGenesisHash` (2×),
`getBalance`, `requestAirdrop`, `getMinimumBalanceForRentExemption` (4×),
`getAccountInfo` (config/project/node reads), `getLatestBlockhash` (per tx),
`sendTransaction` + `confirmTransaction` (4 txs), `simulateTransaction` (CU
probe). No retry logic is exercised on localnet; a single
`send_and_confirm_transaction` round confirmed each transaction on first
submission. Idempotent retry semantics (re-sending an already-applied intent)
are covered in the LiteSVM suite, where the program's init-or-compare path is
the thing under test (byte-identical resubmission is filtered by the
runtime's duplicate-signature check before reaching the program, as on a real
cluster).

## Commands to reproduce

```bash
# inside WSL2 (Ubuntu-24.04)
export PATH=/root/.local/share/solana/install/active_release/bin:/root/.avm/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_TARGET_DIR=/root/tessera-target
cd /mnt/c/Users/93rob/Documents/GitHub/Tessera

anchor build --arch v2                       # produces target/deploy/tessera.so + IDL
cargo test -p tessera                        # wire/econ unit tests (fixture digest)
cargo test -p tessera-program-tests          # LiteSVM suite + golden vectors + footprint
cargo test -p tessera-program-tests --test footprint -- --nocapture

# live validator path (or run ops/localnet-t03.sh end-to-end)
solana-test-validator --reset --ledger /tmp/tessera-ledger --rpc-port 8899 --faucet-port 9900 &
solana -u http://127.0.0.1:8899 program deploy /root/tessera-target/deploy/tessera.so \
    --program-id /root/tessera-target/deploy/tessera-keypair.json
TESSERA_LOCALNET_RPC=http://127.0.0.1:8899 \
    cargo test -p tessera-program-tests --test localnet_e2e -- --nocapture
```

## Test evidence summary

- `cargo test -p tessera` — 3 unit tests pass (intent wire bytes == 348 B
  golden fixture; digest ==
  `17ec80050a9b433b4131a60e794dc828222e235186f2af3bbdb4cbb36f5cc93d`;
  residual-v1 boundary + economics-vector steps).
- `cargo test -p tessera-program-tests --test litesvm_suite` — **18/18 pass**
  (5 happy-path incl. REVIEWED controller co-sign, zero/100% claims, siblings,
  idempotent replay; 13 adversarial incl. wrong signer, cross-project parent,
  wrong network/program/project domain, terms mismatch, claim >10000, nonce
  conflict, lookalike/malformed/non-canonical parents, depth bound, malformed
  instruction bytes, missing/wrong controller, string/reference bounds,
  root misuse, uninitialized config).
- `golden_vectors` — emits `generated/vectors/account-layout-v1.json`.
- `footprint` — the MEASURE table above.
- `localnet_e2e` — **pass** on live `solana-test-validator` (root + child
  created over real RPC; economics and digest asserted from on-chain bytes).

## Honest gaps / next packet

- `publish_statement` is intentionally **not** implemented; only the
  `StatementRecord` account layout is committed (golden vectors + SPACE).
- REVIEWED policy is implemented as a recorded-controller co-signer
  (`Option<Signer>`); there is no separate approval phase/state — matches
  docs/04 "controller co-sign" scope for T03.
- No `close`, no admin mutation, no upgrade-authority renunciation (upgrade
  authority on localnet is the disposable dev keypair; a devnet/mainnet
  deployment decision is T09 + founder approval).
- LiteSVM 0.10 cannot load the default SBPF v3 artifact — tests and the
  committed binary use `--arch v2`. If a future anchor/agave toolchain
  defaults to v3+ semantics, re-verify the loader matrix.
- Rent deposits are localnet quotes; devnet quotes are identical (same
  rent parameters) but mainnet figures must be re-measured in T09.
- Next ready packet: **T04** (SDK, sponsor relayer, finality reconciliation)
  consumes this IDL + instruction surface.
