# SDK, CLI, indexer and independent explorer

## Packages and boundaries

`packages/math`: no network, deterministic integer preview, ancestry validation and settlement allocation.

`packages/types`: generated schema/types, binary codecs, network/rule identifiers and error codes. It must not import Morpheus models or React.

`packages/sdk`: RPC/read/submit adapters, fee estimates, intent creation, signing hooks, status reconciliation, export/recovery and verification report generation. Signing is injected; no globally imported private key.

`apps/explorer`: minimal React/TypeScript public viewer usable against an RPC or local evidence bundle. Read-only by default; creation is an optional generic demo tool and not a prerequisite for Morpheus users.

`apps/cli`: `preview`, `inspect`, `verify`, `export`, `quote`, `recover-index`, and explicitly gated `submit`. These are target commands to implement, not commands already present in this seed. Error exit codes distinguish invalid evidence, incomplete evidence, network failure and unsupported version.

## SDK behavior

Expose the shared TesseraPort and portable library APIs. `previewAppend` returns exact units plus formatted display values, complete parent/rule reference and warnings. `getPayouts` traverses/validates ancestors, groups by beneficiary for money allocation and retains individual contribution rows for credits. `submitSignedContribution` returns deterministic submission identity; polling is bounded with backoff and cancellation. `exportBranch` writes originals, not regenerated JSON pretending to match historical bytes.

No API represents an as-is percentage as a float authority. Always return numerator/denominator, selected-version reference and algorithm version. A null payout on all-zero issued state is explicit. Payout routing to a bank account is outside this SDK: identity and beneficiary key are not bank details.

## Indexing

The initial indexer is a derived cache for known projects/leaves, backed by a small SQL table or file for the demo. Read after finalized writes, reconcile on a schedule and expose sync state. Do not run a full mainnet firehose. Cache immutable node account content aggressively; batch bounded ancestor reads; use provider rate limits and costs [S12,S15]. Account state provides recovery if event history is missing.

Future global discovery can index program accounts with incremental checkpoints and independent mirrors. It must not become the only way to interpret the protocol. A misleading index can affect discovery but cannot change a verified node's arithmetic.

## Explorer UX

Primary input: node address plus network, or evidence file. Primary view: project → selected version → ancestors → payout table. Show chosen name alongside abbreviated public key; hover/copy reveals full key. Prominently distinguish effective capacity, claim against incoming residual, and as-is payout for the selected version. Selecting another version updates the whole table and URL.

Verification panel uses separate labels: signed by key, bytes match, math matches, chain account matches, terms available, identity/ownership not independently verified. Show custody mode and program upgrade status. Never use “copyright verified,” “court-proof,” “permanent forever” or “paid” for an unexecuted payout calculation.

Use accessible tables/lists before a graph canvas. A graph can enhance exploration, but the keyboard/table path must expose every node without pan/zoom. Cap huge imports with progressive loading. Escape all names/metadata; disable raw HTML rendering. Prefer a restrained infrastructure visual identity, not Morpheus branding.

## Distribution and interoperability

Publish a pinned package/tarball with source commit, license decision, API docs, checksums and generated IDL. Do not assume the npm name `tessera` is available. A scope can be chosen after ownership checks. The schema's semantic version and deployed program version are not necessarily the same as app release version.

Export mapping to W3C PROV/C2PA is optional later [S22,S23]. Preserve exact Tessera economics even when an external standard cannot express residual claims directly. Existing standards reduce integration burden; they are not evidence that every app should adopt Tessera.
