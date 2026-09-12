# Persistence, evidence bundles and independent recovery

## Four things that must survive separately

1. **Core state:** on-chain node/account data, economic parent and derived units.
2. **Meaning:** original metadata, statements, terms and artifact bytes that match those hashes.
3. **Control:** contributor recovery/key access under the chosen identity model.
4. **Verification software:** versioned open formats, decoders and independent test vectors.

Keeping only the first does not make a legal agreement recoverable. Keeping a hash on Solana cannot reconstruct missing prose/audio, and a provider URL is not a persistence guarantee. Blockchain history is not a trustless replacement for backups or a guarantee about bankruptcy treatment. [S09,S12,S29–S37]

## Evidence bundle v1

A ZIP or directory contains `bundle.json`, `records/`, `intents/`, `signatures/`, `metadata/`, `terms/`, `artifacts/` when licensed/permitted, and `verification/`. `bundle.json` inventories every included file's relative path, SHA-256 and byte length; it includes exporter version and selected leaf. Reject absolute paths, symlink escapes, `..`, zip bombs and duplicate normalized paths on import.

Each record retains the exact core view, chain reference, slot, observed timestamp, transaction signature and relevant program/rule version. Each intent retains exact signed bytes and detached signature, not a reconstructed approximation. Metadata/terms retain their original bytes. A payout table includes exact beneficiary weights, issued denominator and settlement algorithm version; names help reading but keys identify beneficiaries.

By default exclude private keys, passwords, identity documents, authentication logs, private messages and unrelated collaborator files. An encrypted recovery package is a separate deliberate action. Do not ship someone else's restricted licensed source work to every listener merely because it is part of a production's provenance.

## Verification report, not a magic green tick

Report independent statuses: schema supported, artifact integrity, metadata integrity, terms present/integrity, intent signatures, parent continuity, arithmetic consistency, live chain/account match, finalized observation, known program binary/upgrade state, and rights/identity verification **not established** unless supported by explicit external evidence.

Offline mode checks bytes, signatures and economics using the bundle. It cannot independently establish live Solana finality merely because a JSON field says finalized. Online mode queries an independent configured RPC and compares current account state, owner/program and commitment. A sophisticated archival proof/checkpoint verification system is outside v1; label the RPC trust assumption clearly.

Unreachable URI or missing ancestor returns incomplete evidence, not forged/valid by default. Known-invalid signature/hash returns invalid. Unknown schema is preserved without claiming semantic validation. Distinguish an unavailable network from a contradictory record.

## Recovery path

A node account stores its parent address; walk ancestors until the root, with visited-set/cycle/depth checks and caching. Program account scans can rebuild a child index if RPC permits, but a full global search is not required to verify one known leaf. Preserve project and leaf addresses in user exports and receipts. Current-state account data is primary; do not depend solely on historical transaction logs that free RPC endpoints may prune or restrict.

Public metadata/terms should have at least two independent copies before durable claims are marketed: user export plus an operator backup is the minimum; a separate mirror/provider or content-addressed store is a later improvement. IPFS pinning and Arweave permanence each have costs/trust assumptions, not an automatic free solution. R2-only URIs plus no exports fail the shutdown test.

## Retention and removal

Unpublished drafts can be deleted under an application retention policy. Finalized on-chain name/hash/economic state is public and generally not erasable by the app. Explain this before signing and never put home addresses, identity documents or secrets into those records. A private file can be removed from hosting after a valid claim while its historical hash remains. Public restrictions/retractions can describe the dispute without claiming the original never existed.

Users can request an updated export at any time; emit one at each accepted contribution/release. Periodically test restoring from backups into a fresh machine with Morpheus disabled. Record what cannot be reconstructed. The system must not advertise that a seed proves legal ownership merely because a competitor cannot locate an earlier timestamp.
