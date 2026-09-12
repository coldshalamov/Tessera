# Solana program design and implementation plan

## Stack and account model

Use Rust and Anchor as the default developer ergonomics layer [S14]. T03 validates toolchain compatibility and benchmarks bytecode/account sizes before committing to a mainnet budget. A smaller native Rust implementation is an evidence-based alternative if Anchor binary size materially raises funding needs; do not rewrite merely to chase aesthetics. Record CLI/compiler/SDK versions and lockfiles at implementation time rather than guessing current compatible versions in this packet.

V1 has `ProjectAccount` and immutable `ContributionAccount`. A user's public key need not have a separate program account or token account. Each finalized node is an account owned by the program, discoverable without relying on an indexer's historic event log. Project account includes rule/version, creator/controller keys, extension policy, root pointer, terms digest and bounded label. Node includes economic parent, signer, chosen name, intent/artifact/metadata/terms hashes, derived units, nonce, slot/time and state version.

Account creation is funded by an explicitly authorized sponsor or signer. Deposit/rent capital is distinct from transaction fees [S08–S11]. Do not close finalized records to reclaim funds while claiming they persist. Packing records into pages is a later cost optimization because allocation, locking and independent recovery become more complex. Benchmark one-node-account cost first and cap sponsorship.

## Instructions

`create_project`: enforce empty/new PDA, fixed rule/U, valid immutable policy, bounded strings and terms digest. Create root in the same transaction if size allows; otherwise project exists in an uninitialized-root state and only creator can set the unique root.

`publish_root`: require project creator/signature, unused root, root input residual U, valid intent, signer authorization and consent digest. Fill computed economic fields and set root pointer atomically.

`append_contribution`: require parent owned by this program and belonging to the same project, valid initialized account format (the app checks finality before presenting a parent; the program checks account state, not an RPC commitment label), active parent reference, child signer, policy/controller consent where required, unique nonce/PDA and checked claim. Derive new fields from the parent; ignore/reject client supplied contradictory caches. Create exactly one child. Parent economic state is read-only, so two children need not fight over a global residual balance: they are alternatives, not withdrawals from shared cash.

`publish_statement` can be deferred until after append/export, or implemented as a distinct bounded append-only evidence record for retraction/key continuity. It MUST NOT reallocate a node. No arbitrary invocation forwarding or payout instruction exists in v1.

## Authorization invariants

All accounts have expected owners/discriminators/versions; PDA seeds and bumps are recomputed. Parent cannot be a system account whose bytes resemble a node. Project/controller must match recorded state. Native transaction signer must equal contribution identity. A fee payer is not an author, beneficiary or consent authority. Cross-network/program replay is rejected by the committed domain fields.

Depth = parent depth + 1, with root depth zero. Existence of a previously created parent plus immutability prevents a future node from pointing back to itself. Still test malformed/cyclic export bundles separately. Enforce `MAX_DEPTH = 1,024` in v1 program and SDK (root depth zero, at most 1,025 nodes per path). This is an explicit protocol-version bound for predictable recovery/verification, not a hidden app-only rule. A future larger bound requires a versioned compatibility decision.

There is no global project-head counter needed to append. Unique signer nonce handles idempotency; the indexer derives children. Avoid mutable per-project child arrays that grow without limit or serialize every writer on one account. Statistics belong in derived caches.

## Funds and sponsor service

The program does not hold distributable receipts or transfer tokens. A sponsor pays SOL only for validated Tessera writes. A server compiles its own transaction from a reviewed semantic intent; allowlists program IDs, instruction types and fee/rent limits; verifies every account and signer; simulates; obtains the appropriate user/delegated signature; and then signs as fee payer. Block unsolicited token-transfer, account-close or arbitrary CPI instructions. Cap attempts, records and total SOL by user/day/project.

Quote rent with the live `getMinimumBalanceForRentExemption` for exact bytes, and fee/priority estimates for the exact message. Do not label a quote as a guarantee against changing network fees. Transactions expired by blockhash can be refreshed without creating a new claim; when a PDA already exists, compare committed intent digest and return the existing record or conflict, never silently accept different data.

## Deployments and upgrades

Local validator first; devnet next. Create reproducible build artifacts, program ID, IDL, source commit, toolchain versions, binary hash and deployment receipt. Mainnet is an explicit approval gate with a measured SOL budget and security review. Keep program deployment authority separate from fee-payer spending keys and application auth secrets.

A devnet/pilot program can be upgradeable, but explorer/exports MUST disclose authority and upgrade status. The durable production target is immutable versioned program code after review, with explicit opt-in migration to later versions. Removing an upgrade authority is irreversible and requires founder confirmation. Until it occurs, do not claim even immutable-looking account data is beyond the upgrade authority's control.

Changing rule semantics requires a new program/rule version and explicit migration agreement; an SDK update cannot reinterpret historical records. Old binary decoders and fixtures remain available. If a defect is found, pause sponsorship/app publication, disclose affected program/version, preserve records, and repair through transparent migration—not secret administrator edits.

## Required measurements

Produce `reports/program-footprint.md` with measured account byte sizes, compiled program size, worst-case transaction size/signature count, compute units for root/append/zero/100% claims, rent quotes from target cluster, fee estimates, RPC method counts and retry cases. Budget should distinguish committed deposits, potentially reclaimable temporary deployment buffers and consumed fees. Sample production account count comes from the approved beta cap, not a fictional million-user scale.
