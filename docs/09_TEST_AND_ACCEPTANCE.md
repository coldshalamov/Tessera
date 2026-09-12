# Test strategy and release acceptance

## Mathematical reference

Run the supplied Python reference suite before implementing, then port vectors to TypeScript/Rust. Test roots, siblings, zeros, 100%, rounding-to-zero, large values, repeated beneficiary identities, malformed amounts and every canonical example. Random paths must preserve bounds and `sum weights + residual = U`; settlements must conserve all minor units; no non-ancestor receives money.

Rust, TypeScript and Python must agree exactly on every vector. Property testing covers thousands of random paths and allocations with a fixed reproducible seed plus CI-random seeds recorded on failure. Fuzz decimal parsing, serialization boundaries, account constraints and evidence ZIP input. A percentage formatted to four places is not an assertion of exact numerical equality.

## Local validator and program tests

Create/open project; create root once; append two siblings from same parent; verify immutable parent; append zero node; exhaust residual; reject later positive claims; use wrong project/program owner; wrong signer; unauthorized controller; duplicate nonce same intent; duplicate nonce changed intent; integer overflow; maximum strings; malformed UTF-8; excessive depth; transaction envelope overflow. Reject every path that could create a partial account with inconsistent economics.

Simulate concurrent submissions, expired blockhash and ambiguous network timeout after successful execution. The SDK must return the existing PDA on recovery rather than create a second claim. Confirm/Finalize UI states must survive refresh. Reconciliation from live accounts must rebuild the same projection after deleting the cache.

## Evidence tests

Sign exact intent bytes; change name, parent, digest, nonce or claim; fail verification. Same bytes signed in another program/network fail domain validation. Missing metadata/terms is incomplete, not valid ownership. A detached signature with no chain evidence is “signature valid; anchoring unverified.” A signed false authorship claim may pass crypto tests and must still not be labeled copyright ownership.

Export and restore on a clean machine with both original servers unavailable. Traverse from the leaf address online; verify known files offline; compare exact payout tables. Import a zip bomb/path traversal/symlink/duplicate path and reject safely. Never execute imported scripts.

## Wallet/sponsor tests

Exercise ordinary OAuth to sign in-app; creator cancellation; provider outage; export; reauthentication; wrong user's intent; arbitrary transaction injection; wallet-drain instruction; huge fee bid; repeated bot submissions; depleted budget. Mainnet switches off by default in tests. Scan build artifacts/logs for test secrets too, so unsafe logging habits are caught before production keys exist.

## UX and performance

A nontechnical reader can identify who gets what if the current version sells, distinguish residual from cash, and switch between old/new versions without confusion. Keyboard/screen-reader paths expose the payout table and copy/export controls. Test empty, large, unknown-schema, offline, disputed and invalid records.

Record actual transaction size, compute and account bytes; actual RPC method counts at 10/100/1,000-node path lengths; memory/time of export. Initial demo targets a 100-node path inspection in under a few seconds on the chosen test connection, but report measured results instead of claiming a universal latency SLA. Cache immutable ancestors and make progress/cancellation visible.

## Definition of ready

L1: all deterministic and local/devnet integration tests pass, no custody of value, precise test-network labeling, independent export works. L2: additionally measured budget, independent program/key review, deployment manifest, authority disclosure, data/terms backups and incident runbook. Commercial adopters additionally pass their own revenue accounting, legal permissions and payout tests. Tessera passing tests does not certify Morpheus's input receipts or content legality.
